-- PayRoute Transit (escrow) accounts — one per destination currency for settlement.
-- Settlement debits from Transit and credits the recipient.
INSERT INTO accounts (id, name, currency, balance, ledger_balance) VALUES
  ('a0000000-0000-0000-0000-000000000099', 'PayRoute Transit', 'USD', 1000000.0000, 1000000.0000),
  ('a0000000-0000-0000-0000-000000000098', 'PayRoute Transit', 'EUR', 1000000.0000, 1000000.0000),
  ('a0000000-0000-0000-0000-000000000097', 'PayRoute Transit', 'GBP', 1000000.0000, 1000000.0000)
ON CONFLICT (name, currency) DO NOTHING;

-- Update existing seed settlement debit (e3) to use Transit USD instead of sender.
UPDATE ledger_entries
SET account_id = (SELECT id FROM accounts WHERE name = 'PayRoute Transit' AND currency = 'USD' LIMIT 1),
    description = 'Debit from PayRoute Transit'
WHERE id = 'e0000000-0000-0000-0000-000000000003'
  AND (SELECT id FROM accounts WHERE name = 'PayRoute Transit' AND currency = 'USD' LIMIT 1) IS NOT NULL;

-- Adjust Transit USD balance for the seed settlement (100 USD already paid out in seed data).
UPDATE accounts
SET balance = 999900.0000,
    ledger_balance = 999900.0000
WHERE name = 'PayRoute Transit' AND currency = 'USD';
