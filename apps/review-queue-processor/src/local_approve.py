"""Local approval — create purchase + inventory records directly in Supabase.

Replaces the Vercel approve endpoint with direct database writes.
"""

import logging
import re
from datetime import datetime

from src.brickset_lookup import lookup_set
from src.supabase_client import _client

log = logging.getLogger(__name__)

# Cached user_id (fetched once from profiles table)
_user_id: str | None = None


def _get_user_id() -> str:
    """Get the system user ID from the profiles table.

    Single-user system — uses the first profile as the system user.
    """
    global _user_id
    if _user_id:
        return _user_id

    response = (
        _client.table("profiles")
        .select("id")
        .limit(1)
        .single()
        .execute()
    )
    if not response.data:
        raise RuntimeError("No profile found in database — cannot create records")

    _user_id = response.data["id"]
    log.info("Using user_id: %s", _user_id)
    return _user_id


def _get_next_sku_number() -> int:
    """Find the highest SKU number from recent inventory items.

    SKU format: N123 (New) or U456 (Used).
    Returns the next available number.
    """
    response = (
        _client.table("inventory_items")
        .select("sku")
        .not_.is_("sku", "null")
        .order("created_at", desc=True)
        .limit(200)
        .execute()
    )

    max_num = 0
    sku_pattern = re.compile(r"^[NU](\d+)$")

    for row in response.data or []:
        sku = row.get("sku", "")
        match = sku_pattern.match(sku)
        if match:
            num = int(match.group(1))
            if num > max_num:
                max_num = num

    return max_num + 1


def _determine_payment_method(source: str) -> str:
    """Determine payment method based on purchase source."""
    if source and source.lower() == "vinted":
        return "Vinted Wallet"
    return "PayPal"


def _allocate_costs(items: list[dict], total_cost: float) -> list[float]:
    """Allocate total cost proportionally across multiple items.

    If Brickset RRP data is available, allocate by retail price proportion.
    Otherwise, split equally.
    """
    if len(items) == 1:
        return [total_cost]

    # Check if all items have retail pricing
    rrps = []
    for item in items:
        brickset = item.get("_brickset_data")
        rrp = brickset.get("uk_retail_price") if brickset else None
        rrps.append(float(rrp) if rrp else None)

    all_have_rrp = all(r is not None and r > 0 for r in rrps)

    if all_have_rrp:
        total_rrp = sum(rrps)
        return [round((r / total_rrp) * total_cost, 2) for r in rrps]

    # Equal split fallback
    per_item = round(total_cost / len(items), 2)
    return [per_item] * len(items)


def approve_item(
    email_record: dict,
    identified_items: list[dict],
) -> dict | None:
    """Create purchase + inventory records in Supabase for an identified item.

    This replaces the Vercel approve endpoint.

    Args:
        email_record: The processed_purchase_emails row (full dict).
        identified_items: List of dicts with set_number and condition.

    Returns:
        Dict with purchase_id and inventory_ids on success, None on failure.
    """
    user_id = _get_user_id()
    item_id = email_record["id"]
    source = email_record.get("source", "Vinted")
    total_cost = float(email_record.get("cost", 0) or 0)
    seller = email_record.get("seller_username", "")
    order_ref = email_record.get("order_reference", "")
    email_date = email_record.get("email_date", "")

    # Parse purchase date from email_date
    purchase_date = None
    if email_date:
        try:
            # email_date is stored as TIMESTAMPTZ, parse to date
            dt = datetime.fromisoformat(email_date.replace("Z", "+00:00"))
            purchase_date = dt.strftime("%Y-%m-%d")
        except (ValueError, TypeError):
            purchase_date = datetime.now().strftime("%Y-%m-%d")
    if not purchase_date:
        purchase_date = datetime.now().strftime("%Y-%m-%d")

    # Enrich each item with Brickset data
    enriched_items = []
    for item in identified_items:
        set_number = item.get("set_number", "")
        condition = item.get("condition", "New")

        brickset_data = lookup_set(set_number) if set_number else None
        set_name = brickset_data["set_name"] if brickset_data else set_number

        enriched_items.append({
            "set_number": set_number,
            "condition": condition,
            "set_name": set_name,
            "_brickset_data": brickset_data,
        })

    # Allocate costs
    costs = _allocate_costs(enriched_items, total_cost)

    # Build descriptions
    if len(enriched_items) == 1:
        e = enriched_items[0]
        short_desc = f"{e['set_number']} {e['set_name']}"
        description = f"{e['set_name']} from {seller}" if seller else e["set_name"]
    else:
        set_nums = ", ".join(e["set_number"] for e in enriched_items)
        set_names = ", ".join(e["set_name"] for e in enriched_items)
        short_desc = f"Bundle: {set_nums}"
        description = f"{set_names} from {seller}" if seller else set_names

    try:
        # Step 1: Create purchase record
        purchase_data = {
            "user_id": user_id,
            "source": source,
            "cost": total_cost,
            "payment_method": _determine_payment_method(source),
            "purchase_date": purchase_date,
            "short_description": short_desc,
            "description": description,
            "reference": order_ref or None,
        }

        purchase_response = (
            _client.table("purchases")
            .insert(purchase_data)
            .execute()
        )

        if not purchase_response.data:
            log.error("Failed to create purchase for item %s", item_id)
            return None

        purchase = purchase_response.data[0]
        purchase_id = purchase["id"]
        log.info("Created purchase %s: %s", purchase_id, short_desc)

        # Step 2: Generate SKUs and create inventory items
        next_sku_num = _get_next_sku_number()
        created_inventory_ids: list[str] = []

        for i, enriched in enumerate(enriched_items):
            sku_prefix = "N" if enriched["condition"] == "New" else "U"
            sku = f"{sku_prefix}{next_sku_num + i}"

            notes = f"Imported from {source} email"
            if seller:
                notes += f" (seller: {seller})"

            inventory_data = {
                "user_id": user_id,
                "set_number": enriched["set_number"],
                "item_name": enriched["set_name"],
                "condition": enriched["condition"],
                "cost": costs[i],
                "purchase_id": purchase_id,
                "linked_lot": order_ref or None,
                "source": source,
                "purchase_date": purchase_date,
                "storage_location": "TBC",
                "sku": sku,
                "status": "Not Yet Received",
                "notes": notes,
            }

            inv_response = (
                _client.table("inventory_items")
                .insert(inventory_data)
                .execute()
            )

            if not inv_response.data:
                log.error(
                    "Failed to create inventory item for %s — rolling back",
                    enriched["set_number"],
                )
                _rollback(purchase_id, created_inventory_ids)
                return None

            inv_id = inv_response.data[0]["id"]
            created_inventory_ids.append(inv_id)
            log.info(
                "Created inventory %s: %s %s (SKU: %s, cost: £%.2f)",
                inv_id,
                enriched["set_number"],
                enriched["set_name"],
                sku,
                costs[i],
            )

        # Step 3: Update the email record
        update_data = {
            "status": "imported",
            "purchase_id": purchase_id,
        }
        # Only set inventory_id for single items (not bundles)
        if len(created_inventory_ids) == 1:
            update_data["inventory_id"] = created_inventory_ids[0]

        _client.table("processed_purchase_emails").update(
            update_data
        ).eq("id", item_id).execute()

        log.info("Updated email record %s → imported", item_id)

        return {
            "purchase_id": purchase_id,
            "inventory_ids": created_inventory_ids,
            "short_description": short_desc,
        }

    except Exception as e:
        log.error("Approval failed for item %s: %s", item_id, e)
        return None


def _rollback(purchase_id: str, inventory_ids: list[str]) -> None:
    """Roll back created records if something fails mid-transaction."""
    for inv_id in inventory_ids:
        try:
            _client.table("inventory_items").delete().eq("id", inv_id).execute()
            log.info("Rolled back inventory item %s", inv_id)
        except Exception as e:
            log.error("Failed to rollback inventory %s: %s", inv_id, e)

    try:
        _client.table("purchases").delete().eq("id", purchase_id).execute()
        log.info("Rolled back purchase %s", purchase_id)
    except Exception as e:
        log.error("Failed to rollback purchase %s: %s", purchase_id, e)
