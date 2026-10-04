import type { Metadata } from "next";
import { Listing } from "../_components/listing";

export const metadata: Metadata = { title: "Upcoming" };

export default async function Upcoming({ searchParams }: PageProps<"/upcoming">) {
  return <Listing path="/upcoming" params={await searchParams} heading="Upcoming" />;
}
