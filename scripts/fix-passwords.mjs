import { PrismaClient } from "@prisma/client"
import bcrypt from "bcryptjs"

const prisma = new PrismaClient()

async function fixPasswords() {
  const hashAdmin = await bcrypt.hash("admin123", 10)
  const hashDentista = await bcrypt.hash("dentista123", 10)
  const hashRecepcao = await bcrypt.hash("recepcao123", 10)

  await prisma.user.updateMany({
    where: { username: "admin" },
    data: { passwordHash: hashAdmin, active: true, role: "ADMINISTRADOR" }
  })

  await prisma.user.updateMany({
    where: { username: "dentista" },
    data: { passwordHash: hashDentista, active: true, role: "DENTISTA" }
  })

  await prisma.user.updateMany({
    where: { username: "recepcao" },
    data: { passwordHash: hashRecepcao, active: true, role: "RECEPCAO" }
  })

  console.log("Senhas corrigidas com sucesso usando bcrypt!")
}

fixPasswords()
  .catch(console.error)
  .finally(() => prisma.$disconnect())
