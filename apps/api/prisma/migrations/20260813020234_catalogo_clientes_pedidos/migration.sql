-- CreateTable
CREATE TABLE `Category` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `publicId` VARCHAR(191) NOT NULL,
    `commerceId` INTEGER NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `sortOrder` INTEGER NOT NULL DEFAULT 0,
    `isActive` BOOLEAN NOT NULL DEFAULT true,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `Category_publicId_key`(`publicId`),
    INDEX `Category_commerceId_isActive_sortOrder_idx`(`commerceId`, `isActive`, `sortOrder`),
    UNIQUE INDEX `Category_commerceId_name_key`(`commerceId`, `name`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Product` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `publicId` VARCHAR(191) NOT NULL,
    `commerceId` INTEGER NOT NULL,
    `categoryId` INTEGER NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `description` TEXT NULL,
    `imageUrl` VARCHAR(191) NULL,
    `isAvailable` BOOLEAN NOT NULL DEFAULT true,
    `sortOrder` INTEGER NOT NULL DEFAULT 0,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,
    `deletedAt` DATETIME(3) NULL,

    UNIQUE INDEX `Product_publicId_key`(`publicId`),
    INDEX `Product_commerceId_categoryId_isAvailable_idx`(`commerceId`, `categoryId`, `isAvailable`),
    INDEX `Product_commerceId_name_idx`(`commerceId`, `name`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `ProductVariant` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `publicId` VARCHAR(191) NOT NULL,
    `commerceId` INTEGER NOT NULL,
    `productId` INTEGER NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `priceCents` INTEGER NOT NULL,
    `isAvailable` BOOLEAN NOT NULL DEFAULT true,
    `sortOrder` INTEGER NOT NULL DEFAULT 0,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,
    `deletedAt` DATETIME(3) NULL,

    UNIQUE INDEX `ProductVariant_publicId_key`(`publicId`),
    INDEX `ProductVariant_commerceId_idx`(`commerceId`),
    INDEX `ProductVariant_productId_isAvailable_idx`(`productId`, `isAvailable`),
    UNIQUE INDEX `ProductVariant_productId_name_key`(`productId`, `name`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `ModifierGroup` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `publicId` VARCHAR(191) NOT NULL,
    `commerceId` INTEGER NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `minSelect` INTEGER NOT NULL DEFAULT 0,
    `maxSelect` INTEGER NOT NULL DEFAULT 1,
    `isActive` BOOLEAN NOT NULL DEFAULT true,
    `sortOrder` INTEGER NOT NULL DEFAULT 0,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `ModifierGroup_publicId_key`(`publicId`),
    UNIQUE INDEX `ModifierGroup_commerceId_name_key`(`commerceId`, `name`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `ModifierOption` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `publicId` VARCHAR(191) NOT NULL,
    `commerceId` INTEGER NOT NULL,
    `modifierGroupId` INTEGER NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `priceDeltaCents` INTEGER NOT NULL DEFAULT 0,
    `isAvailable` BOOLEAN NOT NULL DEFAULT true,
    `sortOrder` INTEGER NOT NULL DEFAULT 0,

    UNIQUE INDEX `ModifierOption_publicId_key`(`publicId`),
    INDEX `ModifierOption_commerceId_idx`(`commerceId`),
    UNIQUE INDEX `ModifierOption_modifierGroupId_name_key`(`modifierGroupId`, `name`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `ProductModifierGroup` (
    `productId` INTEGER NOT NULL,
    `modifierGroupId` INTEGER NOT NULL,
    `sortOrder` INTEGER NOT NULL DEFAULT 0,

    PRIMARY KEY (`productId`, `modifierGroupId`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Customer` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `publicId` VARCHAR(191) NOT NULL,
    `commerceId` INTEGER NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `phoneE164` VARCHAR(191) NOT NULL,
    `phoneRaw` VARCHAR(191) NULL,
    `notes` TEXT NULL,
    `ordersCount` INTEGER NOT NULL DEFAULT 0,
    `totalSpentCents` INTEGER NOT NULL DEFAULT 0,
    `lastOrderAt` DATETIME(3) NULL,
    `isActive` BOOLEAN NOT NULL DEFAULT true,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `Customer_publicId_key`(`publicId`),
    INDEX `Customer_commerceId_name_idx`(`commerceId`, `name`),
    UNIQUE INDEX `Customer_commerceId_phoneE164_key`(`commerceId`, `phoneE164`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `CustomerAddress` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `publicId` VARCHAR(191) NOT NULL,
    `commerceId` INTEGER NOT NULL,
    `customerId` INTEGER NOT NULL,
    `label` VARCHAR(191) NULL,
    `street` VARCHAR(191) NOT NULL,
    `number` VARCHAR(191) NULL,
    `apartment` VARCHAR(191) NULL,
    `neighborhood` VARCHAR(191) NULL,
    `city` VARCHAR(191) NULL,
    `reference` TEXT NULL,
    `deliveryZoneId` INTEGER NULL,
    `isDefault` BOOLEAN NOT NULL DEFAULT false,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `CustomerAddress_publicId_key`(`publicId`),
    INDEX `CustomerAddress_commerceId_idx`(`commerceId`),
    INDEX `CustomerAddress_customerId_idx`(`customerId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `DeliveryZone` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `publicId` VARCHAR(191) NOT NULL,
    `commerceId` INTEGER NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `feeCents` INTEGER NOT NULL,
    `estimatedMin` INTEGER NULL,
    `isActive` BOOLEAN NOT NULL DEFAULT true,
    `sortOrder` INTEGER NOT NULL DEFAULT 0,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `DeliveryZone_publicId_key`(`publicId`),
    UNIQUE INDEX `DeliveryZone_commerceId_name_key`(`commerceId`, `name`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `PaymentMethod` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `publicId` VARCHAR(191) NOT NULL,
    `commerceId` INTEGER NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `code` VARCHAR(191) NOT NULL,
    `requiresChangeFor` BOOLEAN NOT NULL DEFAULT false,
    `isActive` BOOLEAN NOT NULL DEFAULT true,
    `sortOrder` INTEGER NOT NULL DEFAULT 0,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `PaymentMethod_publicId_key`(`publicId`),
    UNIQUE INDEX `PaymentMethod_commerceId_code_key`(`commerceId`, `code`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Order` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `publicId` VARCHAR(191) NOT NULL,
    `commerceId` INTEGER NOT NULL,
    `number` INTEGER NOT NULL,
    `businessDate` DATE NOT NULL,
    `type` ENUM('DINE_IN', 'TAKEAWAY', 'DELIVERY') NOT NULL,
    `status` ENUM('PENDIENTE', 'CONFIRMADO', 'EN_PREPARACION', 'LISTO', 'EN_CAMINO', 'ENTREGADO', 'CANCELADO') NOT NULL DEFAULT 'PENDIENTE',
    `source` ENUM('PANEL', 'WHATSAPP', 'PHONE', 'WEB') NOT NULL DEFAULT 'PANEL',
    `customerId` INTEGER NULL,
    `customerName` VARCHAR(191) NOT NULL,
    `customerPhone` VARCHAR(191) NULL,
    `deliveryStreet` VARCHAR(191) NULL,
    `deliveryNumber` VARCHAR(191) NULL,
    `deliveryApartment` VARCHAR(191) NULL,
    `deliveryNeighborhood` VARCHAR(191) NULL,
    `deliveryReference` TEXT NULL,
    `deliveryZoneName` VARCHAR(191) NULL,
    `paymentMethodId` INTEGER NULL,
    `paymentMethodName` VARCHAR(191) NULL,
    `paidWithCents` INTEGER NULL,
    `isPaid` BOOLEAN NOT NULL DEFAULT false,
    `subtotalCents` INTEGER NOT NULL,
    `deliveryFeeCents` INTEGER NOT NULL DEFAULT 0,
    `discountCents` INTEGER NOT NULL DEFAULT 0,
    `totalCents` INTEGER NOT NULL,
    `notes` TEXT NULL,
    `scheduledFor` DATETIME(3) NULL,
    `cancelReason` TEXT NULL,
    `createdByUserId` INTEGER NULL,
    `createdByApiClientId` INTEGER NULL,
    `idempotencyKey` VARCHAR(191) NULL,
    `placedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `Order_publicId_key`(`publicId`),
    INDEX `Order_commerceId_status_placedAt_idx`(`commerceId`, `status`, `placedAt`),
    INDEX `Order_commerceId_businessDate_idx`(`commerceId`, `businessDate`),
    INDEX `Order_commerceId_customerId_placedAt_idx`(`commerceId`, `customerId`, `placedAt`),
    INDEX `Order_commerceId_updatedAt_idx`(`commerceId`, `updatedAt`),
    UNIQUE INDEX `Order_commerceId_businessDate_number_key`(`commerceId`, `businessDate`, `number`),
    UNIQUE INDEX `Order_commerceId_idempotencyKey_key`(`commerceId`, `idempotencyKey`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `OrderItem` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `publicId` VARCHAR(191) NOT NULL,
    `commerceId` INTEGER NOT NULL,
    `orderId` INTEGER NOT NULL,
    `productId` INTEGER NULL,
    `variantId` INTEGER NULL,
    `productName` VARCHAR(191) NOT NULL,
    `variantName` VARCHAR(191) NOT NULL,
    `unitPriceCents` INTEGER NOT NULL,
    `quantity` INTEGER NOT NULL,
    `notes` TEXT NULL,
    `lineTotalCents` INTEGER NOT NULL,

    UNIQUE INDEX `OrderItem_publicId_key`(`publicId`),
    INDEX `OrderItem_commerceId_idx`(`commerceId`),
    INDEX `OrderItem_orderId_idx`(`orderId`),
    INDEX `OrderItem_productId_idx`(`productId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `OrderItemModifier` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `commerceId` INTEGER NOT NULL,
    `orderItemId` INTEGER NOT NULL,
    `optionId` INTEGER NULL,
    `name` VARCHAR(191) NOT NULL,
    `priceDeltaCents` INTEGER NOT NULL,

    INDEX `OrderItemModifier_commerceId_idx`(`commerceId`),
    INDEX `OrderItemModifier_orderItemId_idx`(`orderItemId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `OrderStatusHistory` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `commerceId` INTEGER NOT NULL,
    `orderId` INTEGER NOT NULL,
    `fromStatus` ENUM('PENDIENTE', 'CONFIRMADO', 'EN_PREPARACION', 'LISTO', 'EN_CAMINO', 'ENTREGADO', 'CANCELADO') NULL,
    `toStatus` ENUM('PENDIENTE', 'CONFIRMADO', 'EN_PREPARACION', 'LISTO', 'EN_CAMINO', 'ENTREGADO', 'CANCELADO') NOT NULL,
    `note` TEXT NULL,
    `changedByUserId` INTEGER NULL,
    `changedByApiClientId` INTEGER NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `OrderStatusHistory_commerceId_idx`(`commerceId`),
    INDEX `OrderStatusHistory_orderId_createdAt_idx`(`orderId`, `createdAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `OrderCounter` (
    `commerceId` INTEGER NOT NULL,
    `businessDate` DATE NOT NULL,
    `lastNumber` INTEGER NOT NULL DEFAULT 0,

    PRIMARY KEY (`commerceId`, `businessDate`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `Category` ADD CONSTRAINT `Category_commerceId_fkey` FOREIGN KEY (`commerceId`) REFERENCES `Commerce`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Product` ADD CONSTRAINT `Product_commerceId_fkey` FOREIGN KEY (`commerceId`) REFERENCES `Commerce`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Product` ADD CONSTRAINT `Product_categoryId_fkey` FOREIGN KEY (`categoryId`) REFERENCES `Category`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ProductVariant` ADD CONSTRAINT `ProductVariant_productId_fkey` FOREIGN KEY (`productId`) REFERENCES `Product`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ModifierGroup` ADD CONSTRAINT `ModifierGroup_commerceId_fkey` FOREIGN KEY (`commerceId`) REFERENCES `Commerce`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ModifierOption` ADD CONSTRAINT `ModifierOption_modifierGroupId_fkey` FOREIGN KEY (`modifierGroupId`) REFERENCES `ModifierGroup`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ProductModifierGroup` ADD CONSTRAINT `ProductModifierGroup_productId_fkey` FOREIGN KEY (`productId`) REFERENCES `Product`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ProductModifierGroup` ADD CONSTRAINT `ProductModifierGroup_modifierGroupId_fkey` FOREIGN KEY (`modifierGroupId`) REFERENCES `ModifierGroup`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Customer` ADD CONSTRAINT `Customer_commerceId_fkey` FOREIGN KEY (`commerceId`) REFERENCES `Commerce`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `CustomerAddress` ADD CONSTRAINT `CustomerAddress_customerId_fkey` FOREIGN KEY (`customerId`) REFERENCES `Customer`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `CustomerAddress` ADD CONSTRAINT `CustomerAddress_deliveryZoneId_fkey` FOREIGN KEY (`deliveryZoneId`) REFERENCES `DeliveryZone`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `DeliveryZone` ADD CONSTRAINT `DeliveryZone_commerceId_fkey` FOREIGN KEY (`commerceId`) REFERENCES `Commerce`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `PaymentMethod` ADD CONSTRAINT `PaymentMethod_commerceId_fkey` FOREIGN KEY (`commerceId`) REFERENCES `Commerce`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Order` ADD CONSTRAINT `Order_commerceId_fkey` FOREIGN KEY (`commerceId`) REFERENCES `Commerce`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Order` ADD CONSTRAINT `Order_customerId_fkey` FOREIGN KEY (`customerId`) REFERENCES `Customer`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Order` ADD CONSTRAINT `Order_paymentMethodId_fkey` FOREIGN KEY (`paymentMethodId`) REFERENCES `PaymentMethod`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `OrderItem` ADD CONSTRAINT `OrderItem_orderId_fkey` FOREIGN KEY (`orderId`) REFERENCES `Order`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `OrderItem` ADD CONSTRAINT `OrderItem_productId_fkey` FOREIGN KEY (`productId`) REFERENCES `Product`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `OrderItem` ADD CONSTRAINT `OrderItem_variantId_fkey` FOREIGN KEY (`variantId`) REFERENCES `ProductVariant`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `OrderItemModifier` ADD CONSTRAINT `OrderItemModifier_orderItemId_fkey` FOREIGN KEY (`orderItemId`) REFERENCES `OrderItem`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `OrderStatusHistory` ADD CONSTRAINT `OrderStatusHistory_orderId_fkey` FOREIGN KEY (`orderId`) REFERENCES `Order`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
