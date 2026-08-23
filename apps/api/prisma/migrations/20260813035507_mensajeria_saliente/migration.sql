-- AlterTable
ALTER TABLE `Customer` ADD COLUMN `acceptsNotifications` BOOLEAN NOT NULL DEFAULT true,
    ADD COLUMN `lastInboundAt` DATETIME(3) NULL;

-- CreateTable
CREATE TABLE `OutboundMessage` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `publicId` VARCHAR(191) NOT NULL,
    `commerceId` INTEGER NOT NULL,
    `orderId` INTEGER NULL,
    `customerId` INTEGER NULL,
    `toPhoneE164` VARCHAR(191) NOT NULL,
    `kind` ENUM('ORDER_RECEIVED', 'ORDER_CONFIRMED', 'ORDER_READY_PICKUP', 'ORDER_READY_DINE_IN', 'ORDER_ON_THE_WAY', 'ORDER_DELIVERED', 'ORDER_CANCELLED') NOT NULL,
    `body` TEXT NOT NULL,
    `status` ENUM('PENDING', 'SENT', 'FAILED', 'SKIPPED') NOT NULL DEFAULT 'PENDING',
    `attempts` INTEGER NOT NULL DEFAULT 0,
    `lastError` TEXT NULL,
    `providerMessageId` VARCHAR(191) NULL,
    `skipReason` VARCHAR(191) NULL,
    `sentAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `OutboundMessage_publicId_key`(`publicId`),
    INDEX `OutboundMessage_commerceId_status_createdAt_idx`(`commerceId`, `status`, `createdAt`),
    INDEX `OutboundMessage_orderId_idx`(`orderId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
