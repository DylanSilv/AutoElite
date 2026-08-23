-- Horario de atención del comercio, tal como se lo cuenta el asistente al
-- cliente. Texto libre a propósito: ver el comentario del campo en schema.prisma.
ALTER TABLE `Commerce` ADD COLUMN `openingHours` VARCHAR(191) NULL;
