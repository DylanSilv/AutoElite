-- AlterTable
ALTER TABLE `ApiClient` MODIFY `scopes` JSON NOT NULL;

-- AlterTable
ALTER TABLE `Commerce` ADD COLUMN `whatsappPhoneNumberId` VARCHAR(191) NULL,
    MODIFY `settings` JSON NULL;

-- AlterTable
ALTER TABLE `OutboundMessage` MODIFY `kind` ENUM('AGENT_REPLY', 'ORDER_RECEIVED', 'PAYMENT_REQUESTED', 'PAYMENT_CONFIRMED', 'PAYMENT_REJECTED', 'ORDER_CONFIRMED', 'ORDER_READY_PICKUP', 'ORDER_READY_DINE_IN', 'ORDER_ON_THE_WAY', 'ORDER_DELIVERED', 'ORDER_CANCELLED') NOT NULL;

-- AlterTable
ALTER TABLE `PaymentMethod` MODIFY `allowedOrderTypes` JSON NULL;

-- CreateTable
CREATE TABLE `Promotion` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `publicId` VARCHAR(191) NOT NULL,
    `commerceId` INTEGER NOT NULL,
    `title` VARCHAR(191) NOT NULL,
    `description` TEXT NOT NULL,
    `startsAt` DATETIME(3) NULL,
    `endsAt` DATETIME(3) NULL,
    `weekdays` JSON NULL,
    `isActive` BOOLEAN NOT NULL DEFAULT true,
    `sortOrder` INTEGER NOT NULL DEFAULT 0,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `Promotion_publicId_key`(`publicId`),
    INDEX `Promotion_commerceId_isActive_sortOrder_idx`(`commerceId`, `isActive`, `sortOrder`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Conversation` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `publicId` VARCHAR(191) NOT NULL,
    `commerceId` INTEGER NOT NULL,
    `channel` ENUM('WHATSAPP', 'SIMULATOR') NOT NULL DEFAULT 'WHATSAPP',
    `phoneE164` VARCHAR(191) NOT NULL,
    `customerId` INTEGER NULL,
    `contactName` VARCHAR(191) NULL,
    `status` ENUM('BOT', 'HUMAN', 'CLOSED') NOT NULL DEFAULT 'BOT',
    `handoffReason` VARCHAR(191) NULL,
    `draft` JSON NULL,
    `lastMessageAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `Conversation_publicId_key`(`publicId`),
    INDEX `Conversation_commerceId_lastMessageAt_idx`(`commerceId`, `lastMessageAt`),
    UNIQUE INDEX `Conversation_commerceId_channel_phoneE164_key`(`commerceId`, `channel`, `phoneE164`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `ConversationMessage` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `publicId` VARCHAR(191) NOT NULL,
    `commerceId` INTEGER NOT NULL,
    `conversationId` INTEGER NOT NULL,
    `role` ENUM('CUSTOMER', 'ASSISTANT', 'TOOL', 'STAFF') NOT NULL,
    `body` TEXT NOT NULL,
    `toolName` VARCHAR(191) NULL,
    `toolArgs` JSON NULL,
    `toolResult` JSON NULL,
    `mediaId` VARCHAR(191) NULL,
    `mediaType` VARCHAR(191) NULL,
    `providerMessageId` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `ConversationMessage_publicId_key`(`publicId`),
    UNIQUE INDEX `ConversationMessage_providerMessageId_key`(`providerMessageId`),
    INDEX `ConversationMessage_conversationId_id_idx`(`conversationId`, `id`),
    INDEX `ConversationMessage_commerceId_createdAt_idx`(`commerceId`, `createdAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateIndex
CREATE UNIQUE INDEX `Commerce_whatsappPhoneNumberId_key` ON `Commerce`(`whatsappPhoneNumberId`);

-- AddForeignKey
ALTER TABLE `Promotion` ADD CONSTRAINT `Promotion_commerceId_fkey` FOREIGN KEY (`commerceId`) REFERENCES `Commerce`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Conversation` ADD CONSTRAINT `Conversation_commerceId_fkey` FOREIGN KEY (`commerceId`) REFERENCES `Commerce`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ConversationMessage` ADD CONSTRAINT `ConversationMessage_conversationId_fkey` FOREIGN KEY (`conversationId`) REFERENCES `Conversation`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

