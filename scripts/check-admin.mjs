import { PrismaClient } from "@prisma/client"
import crypto from "crypto"

const prisma = new PrismaClient()

function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString("hex")
  const hash = crypto
    .pbkdf2Sync(password, salt, 1000, 64, "sha512")
    .toString("hex")
  return `${salt}:${hash}`
}

async function check() {
  const admin = await prisma.user.findUnique({
    where: { username: "admin" }
  })
  console.log("Admin found:", admin)
  
  if (!admin) {
    console.log("Criando admin...")
    await prisma.user.create({
      data: {
        username: "admin",
        passwordHash: hashPassword("admin123"),
        role: "ADMINISTRADOR",
        active: true
      }
    })
    console.log("Admin criado com sucesso!")
  } else {
    // Atualizar senha para garantir
    await prisma.user.update({
      where: { username: "admin" },
      data: { passwordHash: hashPassword("admin123") }
    })
    console.log("Senha do admin atualizada para admin123")
  }
}

check()
  .catch(console.error)
  .finally(() => prisma.$disconnect())
