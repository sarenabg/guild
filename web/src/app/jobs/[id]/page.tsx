import Screen from "@/components/screens/JobRoom";

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <Screen id={id} />;
}
