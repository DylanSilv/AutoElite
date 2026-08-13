-- AlterTable
ALTER TABLE `Commerce` ADD COLUMN `country` VARCHAR(191) NOT NULL DEFAULT 'UY',
    MODIFY `timezone` VARCHAR(191) NOT NULL DEFAULT 'America/Montevideo',
    MODIFY `currency` VARCHAR(191) NOT NULL DEFAULT 'UYU';
