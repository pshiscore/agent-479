import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getDb } from "@/lib/db/client";
import { cityBySlug } from "@/lib/site/queries";
import { Listing } from "../../_components/listing";

export async function generateMetadata({ params }: PageProps<"/city/[slug]">): Promise<Metadata> {
  const city = await cityBySlug(getDb(), (await params).slug);
  return { title: city ? `Things to do in ${city.name}` : "City" };
}

export default async function CityPage({ params, searchParams }: PageProps<"/city/[slug]">) {
  const { slug } = await params;
  const city = await cityBySlug(getDb(), slug);
  if (!city) notFound();
  return <Listing path={`/city/${slug}`} params={await searchParams} fixed={{ city: slug }} hide={["city"]} heading={city.name} subheading="Upcoming events" />;
}
