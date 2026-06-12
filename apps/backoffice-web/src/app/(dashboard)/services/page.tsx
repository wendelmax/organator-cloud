import { getServerSession } from "next-auth";
import { authOptions } from "../../../lib/auth";
import { ServicesClient } from "./ClientPage";

async function getServices(token: string) {
  const res = await fetch("http://localhost:3001/v1/services", {
    headers: { Authorization: `Bearer ${token}` },
    cache: "no-store"
  });
  if (!res.ok) return [];
  return res.json();
}

export default async function ServicesPage() {
  const session = await getServerSession(authOptions);
  const token = (session as any)?.accessToken;
  const services = token ? await getServices(token) : [];
  return <ServicesClient initialServices={services} />;
}
