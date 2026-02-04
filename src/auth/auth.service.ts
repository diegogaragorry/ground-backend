import bcrypt from "bcrypt";
import jwt from "jsonwebtoken";
import { prisma } from "../prisma";

const JWT_SECRET = "super_secret_dev_key";

export async function registerUser(data: {
  email: string;
  password: string;
}) {
  const hashedPassword = await bcrypt.hash(data.password, 10);

  const user = await prisma.user.create({
    data: {
      email: data.email,
      password: hashedPassword,
    },
  });

  return { id: user.id, email: user.email };
}

export async function loginUser(data: {
  email: string;
  password: string;
}) {
  const user = await prisma.user.findUnique({
    where: { email: data.email },
  });

  if (!user) throw new Error("Invalid credentials");

  const valid = await bcrypt.compare(data.password, user.password);
  if (!valid) throw new Error("Invalid credentials");

  const token = jwt.sign({ userId: user.id }, JWT_SECRET, {
    expiresIn: "1d",
  });

  return { token };
}
