CREATE OR REPLACE FUNCTION finance.get_spending_by_category(
  start_date date, end_date date, excluded_ids uuid[]
)
RETURNS TABLE(category_id uuid, category_name text, total_amount numeric)
LANGUAGE sql STABLE AS $function$
  SELECT c.id AS category_id, c.name AS category_name, SUM(-t.amount) AS total_amount
  FROM finance.transactions t
  JOIN finance.categories c ON t.category_id = c.id
  WHERE t.date >= start_date AND t.date <= end_date
    AND c.is_income = false AND NOT (c.id = ANY(excluded_ids))
  GROUP BY c.id, c.name ORDER BY total_amount DESC;
$function$;

CREATE OR REPLACE FUNCTION finance.get_budget_vs_actual(
  p_year integer, p_month integer DEFAULT NULL::integer
)
RETURNS TABLE(category_id uuid, category_name text, group_name text, is_income boolean, budget_amount numeric, actual_amount numeric)
LANGUAGE sql STABLE AS $function$
  WITH budget_data AS (
    SELECT b.category_id, SUM(b.amount) AS budget_amount
    FROM finance.budgets b
    WHERE b.year = p_year AND (p_month IS NULL OR b.month = p_month)
    GROUP BY b.category_id
  ),
  actual_data AS (
    SELECT t.category_id,
      SUM(CASE WHEN c.is_income AND t.amount > 0 THEN t.amount
               WHEN NOT c.is_income THEN -t.amount ELSE 0 END) AS actual_amount
    FROM finance.transactions t
    JOIN finance.categories c ON c.id = t.category_id
    WHERE EXTRACT(YEAR FROM t.date) = p_year
      AND (p_month IS NULL OR EXTRACT(MONTH FROM t.date) = p_month)
      AND t.category_id IS NOT NULL
    GROUP BY t.category_id
  )
  SELECT c.id, c.name, c.group_name, c.is_income,
    COALESCE(bd.budget_amount, 0), COALESCE(ad.actual_amount, 0)
  FROM finance.categories c
  LEFT JOIN budget_data bd ON c.id = bd.category_id
  LEFT JOIN actual_data ad ON c.id = ad.category_id
  WHERE bd.budget_amount IS NOT NULL OR ad.actual_amount IS NOT NULL;
$function$;

CREATE OR REPLACE FUNCTION finance.get_savings_rate(
  p_year integer, p_month integer DEFAULT NULL::integer
)
RETURNS TABLE(total_income_budget numeric, total_expense_budget numeric, total_income_actual numeric, total_expense_actual numeric, savings_rate_budget numeric, savings_rate_actual numeric)
LANGUAGE sql STABLE AS $function$
  WITH budget_totals AS (
    SELECT COALESCE(SUM(CASE WHEN c.is_income THEN b.amount ELSE 0 END), 0) AS income_budget,
           COALESCE(SUM(CASE WHEN NOT c.is_income THEN b.amount ELSE 0 END), 0) AS expense_budget
    FROM finance.budgets b JOIN finance.categories c ON b.category_id = c.id
    WHERE b.year = p_year AND (p_month IS NULL OR b.month = p_month)
  ),
  actual_totals AS (
    SELECT COALESCE(SUM(CASE WHEN c.is_income IS TRUE AND t.amount > 0 THEN t.amount ELSE 0 END), 0) AS income_actual,
           COALESCE(SUM(CASE WHEN c.is_income = false THEN -t.amount
                             WHEN c.is_income IS NULL AND t.amount < 0 THEN ABS(t.amount)
                             ELSE 0 END), 0) AS expense_actual
    FROM finance.transactions t LEFT JOIN finance.categories c ON t.category_id = c.id
    WHERE EXTRACT(YEAR FROM t.date) = p_year
      AND (p_month IS NULL OR EXTRACT(MONTH FROM t.date) = p_month)
      AND COALESCE(c.exclude_from_totals, false) = false
  )
  SELECT bt.income_budget, bt.expense_budget, at.income_actual, at.expense_actual,
    CASE WHEN bt.income_budget > 0 THEN ((bt.income_budget - bt.expense_budget) / bt.income_budget) * 100 ELSE 0 END,
    CASE WHEN at.income_actual > 0 THEN ((at.income_actual - at.expense_actual) / at.income_actual) * 100 ELSE 0 END
  FROM budget_totals bt, actual_totals at;
$function$;;
