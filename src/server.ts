import dns from "dns";

// Railway puede no tener IPv6; forzar IPv4 para SMTP (Gmail)
dns.setDefaultResultOrder("ipv4first");

import app from "./app";

const PORT = 3000;

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});