-- Receipt/invoice reference for a manually confirmed offline_invoice payment.
ALTER TABLE "print_orders" ADD COLUMN "paymentReference" TEXT;
