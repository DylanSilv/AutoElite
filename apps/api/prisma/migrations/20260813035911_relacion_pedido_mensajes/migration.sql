-- AddForeignKey
ALTER TABLE `OutboundMessage` ADD CONSTRAINT `OutboundMessage_orderId_fkey` FOREIGN KEY (`orderId`) REFERENCES `Order`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
