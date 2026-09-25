-- Free-shipping threshold per shipping method (also applies to pickup
-- methods). NULL = no threshold, the method's price always applies.
ALTER TABLE "shipping_methods" ADD COLUMN "freeShippingThresholdCents" INTEGER;
