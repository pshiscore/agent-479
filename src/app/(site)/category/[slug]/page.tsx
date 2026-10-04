import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getDb } from "@/lib/db/client";
import { categoryBySlug } from "@/lib/site/queries";
import { Listing } from "../../_components/listing";

export async function generateMetadata({ params }: PageProps<"/category/[slug]">): Promise<Metadata> {
  const category = await categoryBySlug(getDb(), (await params).slug);
  return { title: category?.name ?? "Category" };
}

export default async function CategoryPage({ params, searchParams }: PageProps<"/category/[slug]">) {
  const { slug } = await params;
  const category = await categoryBySlug(getDb(), slug);
  if (!category) notFound();
  return <Listing path={`/category/${slug}`} params={await searchParams} fixed={{ category: slug }} hide={["category"]} heading={category.name} subheading="Upcoming events across Northwest Arkansas" />;
}
