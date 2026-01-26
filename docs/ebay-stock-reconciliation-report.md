# eBay Stock Reconciliation Report
**Date:** 2026-01-24

## Executive Summary

Comparison between database (334 items listed on eBay) and physical stock take (226 entries across 2 locations).

**Key Findings:**
- **Location Reorganization:** Items were moved to new E1-E6 locations per official mapping - DB needs bulk update
- **Phantom Stock (CRITICAL):** 14+ items at "Garage - Ebay New Shelf" marked as ALL SOLD but physically present
- Several items appear to have been sold but remain listed in DB
- Stock take contains items not found in DB (8+ items need adding)
- Many items flagged as "uncertain" in stock take need verification

---

## 1. Location Mapping (Reorganization Applied)

Items were recently reorganized to new locations. The following mapping was applied:

### Official Location Mapping

| Old DB Location(s) | New Stock Take Location |
|--------------------|-------------------------|
| Garage - 102, Garage - 104 | E1 |
| Garage - 101, Garage - 103, Garage - T8 | E2 |
| Garage - 109, Garage - BIO1 | E3 |
| Garage - 108, Garage - T1, Garage - T3 | E4 |
| Garage - 107, Garage - 106, Garage - 105 (Exc. Minifigs) | E5 |
| Garage - T4, T5, T6, T10, T15 (Exc. Mini), T11, T7 | E6 |

### Additional Location Naming Variations

| Stock Take Location | DB Location | Match Status |
|---------------------|-------------|--------------|
| E8, E9, E10 | Garage - E8, E9, E10 | Needs prefix normalization |
| eBay Used Shelf | Garage - EBAY USED BOXED | Needs normalization |
| SNUG-201 | Garage - 201 | Needs normalization |
| 301-1, 301-2, etc. | Garage - 301-1, etc. | Partial match |
| 30-4 | Garage - 301-4? | Possible typo |
| Garage - Ebay New Shelf | Not in DB | New location for sealed sets |

---

## 2. Items in DB NOT Found in Stock Take

These items are marked as LISTED in the database but were not found in the physical stock take.
**Possible explanations:** Sold but not updated, moved to different location, or missing.

### Priority Check - Potential eBay Sales Found

Based on eBay order data, these items may have been SOLD but are still marked as LISTED:

| Set # | Item Name | DB Location | eBay Order Evidence |
|-------|-----------|-------------|---------------------|
| 253 | Helicopter and Pilot | Garage - 201 | Order Dec 26 - NOT_STARTED status |
| 21305 (Ideas Maze) | - | Garage - Own Box | Sold Dec 1 (SKU U649) |
| 6456 (Mission Control) | - | Garage - EBAY USED BOXED | Sold Dec 3 (SKU U1652) |
| 8746 (Visorak Keelerak) | - | Garage - E4 | Sold Nov 21 (SKU U1617) |
| 8914 (Toa Hahli) | - | Garage - E3 | Sold Sep 25 (SKU U1616) |

### Items in DB with Old Locations (Need DB Update per Mapping)

Per the location reorganization, these items should now be in E1-E6:

| Old DB Location | Expected New Location | Items |
|-----------------|----------------------|-------|
| Garage - 102, 104 | E1 | Multiple items |
| Garage - 101, 103 | E2 | Multiple items (E2 not in stock take) |
| Garage - 109, BIO1 | E3 | Multiple items |
| Garage - 108, T1, T3 | E4 | Multiple items |
| Garage - 107, 106, 105 | E5 | Multiple items |
| Garage - T4, T5, T6, T10, T15, T11, T7 | E6 | Multiple items |

### Items in Locations NOT Reorganized (Still Need Stock Take)

| Location | Notes |
|----------|-------|
| HP075 | Harry Potter Tournament Uniform - 301-1 |
| NA | Bionicle Magazine - Filing Cabinet |
| NA | Vintage Lego Book + Brochures - Filing Cabinet |
| GARAGE (generic) | 33 items - no sub-location specified |
| Garage - Box | 98 Strictly Briks items |
| Garage - Box Slizers | 1 item |
| Garage - EBAY NEW | 3 items (now "Garage - Ebay New Shelf"?) |
| Garage - Figures | 17 items |
| Garage - Own Box | 13 items |
| Loft locations | 5 items |
| POLY locations | 41 items |

---

## 3. Items in Stock Take NOT Found in DB (as LISTED)

These items appear in the physical stock take but don't match DB records for eBay LISTED items:

### Potential Data Issues (flagged with uncertain marker)

| Set # | Stock Location | Notes |
|-------|----------------|-------|
| 80453 | E1 | Uncertain - needs verification |
| 84531 | E1 | Uncertain - needs verification |
| 42111 | E1 | Uncertain - needs verification |
| 6946 | E1 | Uncertain - needs verification |
| 85979 | E1 | Uncertain - needs verification |
| 40053 | E1 | Uncertain - needs verification |
| 26394 | E1 | Duplo figures note - uncertain |
| 41205 | E1 | Uncertain |
| 4936 | E1 | Uncertain |
| 8794 | E4 | Uncertain |
| 25238 | E4 | Uncertain |
| 133 | E9 | Uncertain |
| 8232 | E5 | Uncertain |
| 41125 | E5 | Uncertain |
| 8742 | E5 | Uncertain |
| 6998 | E5 | Uncertain |
| 8837 | E6 | Uncertain |
| 6695 | E6 | Uncertain |
| 4200 | E6 | Uncertain |
| 8581 | E6 | Uncertain |
| 60174 | E6 | Uncertain |

### Items in Different Status or Platform

These may be listed on a different platform or in different status:

| Stock Take | DB Status Check Needed |
|------------|------------------------|
| 6527 (E1) | DB shows Garage - 104 |
| 6602 (E1) | Not found as eBay listed |
| 21163 (E1) | Not found as eBay listed |
| 42084 (E1) | DB shows Garage - 102 |
| 21220 (E1) | Not found as eBay listed |
| 71004 (E1) | Not found as eBay listed |

---

## 4. Location Mismatch Analysis

Based on the location mapping in Section 1, most "mismatches" are actually **expected moves**:

### ✅ Expected Moves (Matching Reorganization)

| Set # | Item Name | DB Location | Stock Take | Mapping Status |
|-------|-----------|-------------|------------|----------------|
| 6527 | Tipper Truck | Garage - 104 | E1 | ✅ Matches mapping (104 → E1) |
| 42084 | Hook Loader | Garage - 102 | E1 | ✅ Matches mapping (102 → E1) |
| 6603 | Shovel Truck | Garage - 104 | E1 | ✅ Matches mapping (104 → E1) |
| 70599 | Cole's Dragon | Garage - 103 | E1 | ⚠️ Expected E2 (103 → E2) |
| 6555 | Sea Hunter | Garage - 103 | E1 | ⚠️ Expected E2 (103 → E2) |
| 30087 | Ninjago Car | Garage - 109 | E3 | ✅ Matches mapping (109 → E3) |
| 41360 | Emma's Vet Clinic | Garage - 109 | E3 | ✅ Matches mapping (109 → E3) |
| 41100 | Heartlake Private Jet | Garage - 108 | E4 | ✅ Matches mapping (108 → E4) |
| 6508 | Wave Racer | Garage - T3 | E4 | ✅ Matches mapping (T3 → E4) |
| 21178 | The Fox Lodge | Garage - 108 | E4 | ✅ Matches mapping (108 → E4) |
| 21179 | The Mushroom House | Garage - 108 | E4 | ✅ Matches mapping (108 → E4) |
| 21259 | Pirate Ship Voyage | Garage - 108 | E4 | ✅ Matches mapping (108 → E4) |
| 8740 | Toa Hordika Matau | Garage - BIO1 | E4 | ⚠️ Expected E3 (BIO1 → E3) |
| 6697 | Rescue-I Helicopter | Garage - 107 | E5 | ✅ Matches mapping (107 → E5) |
| 6835 | Saucer Scout | Garage - T5 | E6 | ✅ Matches mapping (T5 → E6) |

### ✅ Already at Correct Location (No Update Needed)

| Set # | Item Name | Location | Status |
|-------|-----------|----------|--------|
| 6384 | Police Station | E4 | Already correct |
| 5521 | Sea Jet | E5 | Already correct |
| 8566 | Onua Nuva | E6 | Already correct |
| 8603 | Toa Whenua | E6 | Already correct |
| 8728 | Toa Hahli | E6 | Already correct |
| 8589 | Rahkshi Lerahk | E6 | Already correct |
| 8617 | Zadakh | E6 | Already correct |
| 8976 | Metus | E6 | Already correct (uncertain flag) |
| 2067 | Evo 2.0 | E6 | Already correct |
| 10879 | Gentle Giants Petting Zoo | E8 | Already correct |
| 10839 | Shooting Gallery | E8 | Already correct |

### ⚠️ Unexpected Location (Not Matching Mapping)

| Set # | Item Name | DB Location | Stock Take | Issue |
|-------|-----------|-------------|------------|-------|
| 70599 | Cole's Dragon | Garage - 103 | E1 | Expected E2, found E1 |
| 6555 | Sea Hunter | Garage - 103 | E1 | Expected E2, found E1 |
| 8740 | Toa Hordika Matau | Garage - BIO1 | E4 | Expected E3, found E4 |
| 4779 | Defense Tower | Garage - E7 | E8 | E7 not in mapping, found E8 |
| 41367 | - | Not in DB | E3 | Not found as eBay listed |

---

## 5. Unmatched eBay Orders (Sold but Not Linked)

These eBay orders have SKUs that should match inventory but aren't linked:

| Order Date | SKU | Title | Status |
|------------|-----|-------|--------|
| 2026-01-14 | U2589 - Garage - E7 | Duplo Vintage Track | FULFILLED |
| 2025-12-26 | U1750 - Garage - 201 | Helicopter and Pilot (253) | NOT_STARTED |
| 2025-12-20 | U1744 - Garage - 301-2 | Zane Titanium Minifigure | FULFILLED |
| 2025-12-17 | U1699 - Garage - 201 | Kai Rebooted Minifigure | FULFILLED |
| 2025-12-14 | U1787 - Garage - 301-4 | Grandma Visitor COL112 | FULFILLED |
| 2025-12-14 | U2643 - Garage - E3 | HP & Hermione 76393 | NOT_STARTED |
| 2025-12-03 | U1652 - Garage - EBAY USED BOXED | Mission Control 6456 | FULFILLED |
| 2025-12-01 | U649 - Garage - Own Box | Ideas Maze 21305 | FULFILLED |
| 2025-11-24 | N389 - Garage - EBAY NEW | Stormtrooper Keyring | FULFILLED |
| 2025-11-21 | U1617 - Garage - E4 | Visorak Keelerak 8746 | FULFILLED |
| 2025-11-18 | U1722 - Garage - 301 | Unicorn Guy COL328 | FULFILLED |
| 2025-11-15 | U1625 - Garage - 204 | Knights' Kingdom Bundle | FULFILLED |

---

## 6. Garage - Ebay New Shelf Analysis (NEW Lego Sets)

Stock take identified 37 entries at "Garage - Ebay New Shelf" location. Analysis below:

### ✅ Items Correctly Listed on eBay at GARAGE

| Set # | Item Name | DB Location | Status |
|-------|-----------|-------------|--------|
| 71760 | Jay's Thunder Dragon EVO | GARAGE | LISTED - eBay ✅ |
| 40784 | African Diorama | GARAGE | LISTED - eBay ✅ |
| 60085 | 4x4 with Powerboat | GARAGE | LISTED - eBay ✅ |

### ⚠️ Items Listed on eBay but at Different Location

| Set # | Item Name | DB Location | Stock Take | Action Needed |
|-------|-----------|-------------|------------|---------------|
| 40491 x2 | Year of the Tiger | Loft - S20 | Garage - Ebay New Shelf | Update location in DB |
| 75344 | Boba Fett's Microfighter | Loft - S57 | Garage - Ebay New Shelf | Update location in DB |
| 75299 x2 | Trouble on Tatooine | GARAGE + Loft - S22 | Garage - Ebay New Shelf | Verify quantities match |

### ⚠️ Items Listed on Amazon NOT eBay

These are at "Garage - Ebay New Shelf" but listed on Amazon:

| Set # | Item Name | DB Status | Notes |
|-------|-----------|-----------|-------|
| 7741 | Police Helicopter | LISTED - Amazon | Previously sold on eBay (U942, N2407) |
| 40371 | Easter Egg | LISTED - Amazon (x3) | All at Loft locations |
| 40530 | Jane Goodall Tribute | LISTED - Amazon (x1) | At Loft - S66 |

### ⚠️ Items in BACKLOG Status (Not Yet Listed)

| Set # | Item Name | DB Status | DB Location |
|-------|-----------|-----------|-------------|
| 40675 | Clone Commander Cody | BACKLOG - eBay (x5) | Loft - S121 |
| 40676 | The Phantom Menace | BACKLOG - eBay (x7) | Loft - S71/S121 |

### ❌ Items ALL SOLD in DB (Phantom Stock)

**CRITICAL:** These items are physically present but ALL units are marked as SOLD in the database:

| Set # | Item Name | Stock Take Qty | DB Status |
|-------|-----------|----------------|-----------|
| 853946 | Stormtrooper Keyring | x2 | ALL SOLD (9 entries, all sold on eBay) |
| 40567 | Forest Hideout | x1 | ALL SOLD (Amazon) |
| 40659 | Mini Steamboat Willie | x1 | ALL SOLD (Amazon) |
| 40581 | BIONICLE Tahu and Takua | x1 | ALL SOLD (Amazon) |
| 60283 | Holiday Camper Van | x1 | ALL SOLD (Amazon/eBay) |
| 40609 | Christmas Fun VIP Add-On Pack | x1 | ALL SOLD (Amazon) |
| 40680 | Flower Store | x1 | ALL SOLD (Amazon/eBay) |
| 40689 | Firework Celebrations | x1 | ALL SOLD (Amazon) |
| 40682 | Spring Garden House | x1 | ALL SOLD (Amazon) |
| 40683 | Flower Trellis Display | x1 | ALL SOLD (Amazon) |
| 40687 | Alien Space Diner | x1 | SOLD (Jan 2026) |
| 40685 | Water Park | x1 | SOLD (Jan 2026) |
| 40650 | Land Rover Classic Defender | x1 | ALL SOLD (Amazon) |
| 42169 | NEOM McLaren Formula E | x1 | SOLD (eBay Jan 2025) |

### ❌ Items NOT Found in Database

| Set # | Notes |
|-------|-------|
| 40346 | Not in DB - needs to be added |
| 40568 | Not in DB - needs to be added |
| 40651 | Not in DB - needs to be added |
| 40684 | Not in DB - needs to be added |
| 40686 | Not in DB - needs to be added |
| 75388 | Not in DB - needs to be added |
| 75361 | Not in DB - needs to be added |
| 76293 | Not in DB - needs to be added |
| MAGNET STAND | Could be 5008907/5008908/5008909 - all SOLD |

### ⚠️ Items with Platform Issues

| Set # | Item Name | Issue |
|-------|-----------|-------|
| 9496 | Desert Skiff | LISTED but no platform assigned (null) |
| 311420 | LEGO Magazine foil pack | LISTED but no platform assigned (null) |

---

## 7. Recommended Actions

### Immediate Priority - Phantom Stock Resolution

**CRITICAL:** 14+ items found at "Garage - Ebay New Shelf" are marked as ALL SOLD in the database but physically exist. These need immediate attention:

1. **Verify Physical Stock** - Confirm these items are actually present:
   - 853946 Stormtrooper Keyring (x2)
   - 40567 Forest Hideout
   - 40659 Mini Steamboat Willie
   - 40581 BIONICLE Tahu and Takua
   - And 10 others listed in Section 6

2. **Create New Inventory Records** - If verified present, add new inventory records for these items

3. **Check for Duplicate Sales** - Ensure these weren't sold again without creating new records

### eBay Order Updates

1. **Update Sold Items** - Mark these inventory items as SOLD and link to eBay orders:
   - U1652 (Mission Control 6456)
   - U649 (Ideas Maze 21305)
   - U1617 (Visorak Keelerak 8746)
   - U1616 (Toa Hahli 8914)
   - All other fulfilled orders in Section 5

2. **Investigate NOT_STARTED Orders** - These may need shipping:
   - U1750 - Helicopter and Pilot (253) - order Dec 26
   - U2643 - HP & Hermione 76393 - order Dec 14

### Location Updates

1. **Apply Location Mapping to DB** - Update all DB records to new locations:
   - Garage - 102, 104 → E1
   - Garage - 101, 103, T8 → E2
   - Garage - 109, BIO1 → E3
   - Garage - 108, T1, T3 → E4
   - Garage - 107, 106, 105 → E5
   - Garage - T4, T5, T6, T10, T15, T11, T7 → E6

2. **Update locations** for items found at "Garage - Ebay New Shelf":
   - 40491 (x2) - Move from Loft - S20
   - 75344 - Move from Loft - S57
   - 75299 (x2) - Verify and consolidate

3. **Investigate Unexpected Locations** (Section 4):
   - 70599, 6555 - Found in E1 but should be E2 per mapping
   - 8740 - Found in E4 but should be E3 per mapping
   - 4779 - Found in E8 but E7 not in mapping

### Data Cleanup

1. **Add Missing Items** - 8 items found at Garage - Ebay New Shelf not in DB:
   - 40346, 40568, 40651, 40684, 40686, 75388, 75361, 76293

2. **Fix Platform Assignment** - Assign proper platform to:
   - 9496 (Desert Skiff) - currently no platform
   - 311420 (Magazine foil pack) - currently no platform

3. **Standardize Location Names** - Use short form (E1, E2, etc.) per reorganization

4. **Verify Uncertain Items** - Physical check needed for all items marked with ⚠️ in stock take

5. **Complete Stock Take** - The following old locations should now be empty (moved to E1-E6):
   - Garage - 101 through 109 → Should be in E1-E5
   - Garage - BIO1 → Should be in E3
   - Garage - T1 through T11, T15 → Should be in E4/E6

   Still need stock take coverage for:
   - Filing Cabinet
   - GARAGE (generic)
   - Garage - Box (98 Strictly Briks items)
   - Garage - EBAY NEW
   - Garage - Figures
   - Garage - Own Box
   - Loft locations
   - POLY locations

---

## 8. Summary Statistics

| Metric | Count |
|--------|-------|
| DB Items (eBay LISTED) | 334 |
| Stock Take Entries (Used/Boxed) | 189 |
| Stock Take Entries (New Shelf) | 37 |
| **Total Stock Take Entries** | **226** |
| Expected Location Changes (per mapping) | Many (bulk DB update needed) |
| Unexpected Location Mismatches | 5 |
| Potential Sold Items (from orders) | 12+ |
| Uncertain Items in Stock Take | 30+ |

### Garage - Ebay New Shelf Breakdown

| Category | Count |
|----------|-------|
| Correctly Listed on eBay | 3 |
| Listed on eBay, Wrong Location | 5 |
| Listed on Amazon, Not eBay | 3 |
| BACKLOG Status (not yet listed) | 2 sets (12 units) |
| **Phantom Stock (ALL SOLD in DB)** | **14** |
| Not Found in Database | 8-9 |
| Missing Platform Assignment | 2 |

### Action Priority

1. 🔴 **CRITICAL:** Resolve 14 phantom stock items (physically present but ALL SOLD in DB)
2. 🟠 **HIGH:** Mark fulfilled eBay orders as SOLD in DB
3. 🟡 **MEDIUM:** Apply location mapping to DB (bulk update)
4. 🟢 **LOW:** Add 8 missing items, verify uncertain items

---

*Report generated: 2026-01-24*
*Updated: 2026-01-24 - Added Garage - Ebay New Shelf analysis and location mapping*
