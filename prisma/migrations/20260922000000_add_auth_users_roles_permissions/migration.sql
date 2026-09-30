-- Migration: add_auth_users_roles_permissions
-- Created: 2026-09-22
-- Adds User, Role, Permission, and RolePermission tables for authentication and access control.

-- CreateTable: users
CREATE TABLE "users" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "username" TEXT NOT NULL,
    "password_hash" TEXT NOT NULL,
    "role" TEXT NOT NULL DEFAULT 'DENTISTA',
    "active" BOOLEAN NOT NULL DEFAULT true,
    "professional_id" TEXT,
    "last_login_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "users_professional_id_fkey" FOREIGN KEY ("professional_id") REFERENCES "professionals" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable: roles
CREATE TABLE "roles" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "system" BOOLEAN NOT NULL DEFAULT false,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL
);

-- CreateTable: permissions
CREATE TABLE "permissions" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "module" TEXT NOT NULL,
    "action" TEXT NOT NULL DEFAULT 'write',
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable: role_permissions
CREATE TABLE "role_permissions" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "role_id" TEXT NOT NULL,
    "permission_id" TEXT NOT NULL,
    CONSTRAINT "role_permissions_role_id_fkey" FOREIGN KEY ("role_id") REFERENCES "roles" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "role_permissions_permission_id_fkey" FOREIGN KEY ("permission_id") REFERENCES "permissions" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndexes
CREATE UNIQUE INDEX "users_username_key" ON "users"("username");
CREATE UNIQUE INDEX "users_professional_id_key" ON "users"("professional_id");
CREATE INDEX "users_username_idx" ON "users"("username");
CREATE INDEX "users_active_idx" ON "users"("active");
CREATE UNIQUE INDEX "roles_name_key" ON "roles"("name");
CREATE INDEX "roles_active_idx" ON "roles"("active");
CREATE UNIQUE INDEX "permissions_code_key" ON "permissions"("code");
CREATE INDEX "permissions_module_action_idx" ON "permissions"("module", "action");
CREATE INDEX "permissions_code_idx" ON "permissions"("code");
CREATE UNIQUE INDEX "role_permissions_role_id_permission_id_key" ON "role_permissions"("role_id", "permission_id");