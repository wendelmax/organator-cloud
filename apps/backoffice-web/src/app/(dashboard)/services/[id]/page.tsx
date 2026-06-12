import { ServiceLogsClient } from "./ClientPage";

export default function ServiceDetailsPage({ params }: { params: { id: string } }) {
  return <ServiceLogsClient serviceId={params.id} />;
}
