-- In-store pickup as a delivery option, and the order-side fields to
-- track which path an order takes through fulfillment.
ALTER TABLE "shipping_methods" ADD COLUMN "isPickup" BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE "print_orders" ADD COLUMN "isPickupDelivery" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "print_orders" ADD COLUMN "readyForPickupAt" TIMESTAMP(3);
ALTER TABLE "print_orders" ALTER COLUMN "shippingAddress" DROP NOT NULL;
