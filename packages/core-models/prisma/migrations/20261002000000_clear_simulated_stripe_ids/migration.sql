-- Tenants nasciam com um customer fictício ("cus_simulated_<ts>"), que o portal
-- de cobrança e o upgrade enviavam ao Stripe (erro "No such customer"). O
-- customer real passa a ser gravado pelo webhook de checkout.
UPDATE "Tenant" SET "stripeId" = NULL WHERE "stripeId" LIKE 'cus\_simulated\_%';
