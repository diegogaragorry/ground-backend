import path from "path";
import dotenv from "dotenv";

// Cargar .env lo antes posible (Prisma necesita DATABASE_URL al primer uso)
dotenv.config({ path: path.resolve(__dirname, "..", ".env") });

import dns from "dns";

// Railway puede no tener IPv6; forzar IPv4 para SMTP (Gmail)
dns.setDefaultResultOrder("ipv4first");

import app from "./app";

const PORT = Number(process.env.PORT) || 3000;

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
  console.log(`Backend URL: http://localhost:${PORT}`);
});