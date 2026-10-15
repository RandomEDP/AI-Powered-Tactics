-- The shop: the cage phone mount and team kits (colour, pattern, badge, names and numbers, and Gaffer on the chest for a
-- cheaper shirt). Physical goods are paid for through Stripe Checkout (Apple Pay or card), never Apple's in-app purchase
-- (App Store guideline 3.1.3(e)).
-- Only the shop and shop-webhook edge functions touch this table (service role): the shop prices and saves an order and
-- starts Stripe's payment page; the webhook marks it paid with the delivery address Stripe collected. The app reads
-- its own orders through the shop function ("orders"). Ethan reads and ships orders from the dashboard.
-- (Numbered 0033 because the team pass, 0032, is in its own pull request.) No deletes or drops: fine for the MCP.

create table if not exists public.shop_orders (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users (id) on delete set null,       -- who ordered (kept as null if they delete their account)
  team_id uuid references public.teams (id) on delete set null,     -- the team open when they ordered, if any
  item text not null check (item in ('mount', 'kit')),
  lines jsonb not null,                                             -- [{name, each (pence), qty}], as charged
  design jsonb,                                                     -- a kit: {color, color2, pattern, sponsor, badge (data: URL or null)}
  shirts jsonb,                                                     -- a kit: [{name, num, size}]
  total_pence integer not null check (total_pence > 0),
  postage_pence integer not null default 0 check (postage_pence >= 0),
  status text not null default 'awaiting_payment' check (status in ('awaiting_payment', 'paid', 'cancelled', 'sent', 'refunded')),
  stripe_session text unique,
  live boolean not null default false,                              -- false: Stripe test mode, nobody was charged
  email text,
  ship jsonb,                                                       -- {name, address, phone} from Stripe's payment page
  created_at timestamptz not null default now(),
  paid_at timestamptz,
  emailed_at timestamptz                                            -- when the order went to the supplier (a kit) or to Ethan (a mount)
);
create index if not exists shop_orders_user_idx on public.shop_orders (user_id, created_at desc);
create index if not exists shop_orders_status_idx on public.shop_orders (status, created_at desc);
alter table public.shop_orders enable row level security; -- no policies: only the edge functions (service role) use it
revoke all on table public.shop_orders from anon, authenticated;
