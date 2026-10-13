import { SongView } from "@/components/SongView";

export default async function SongPage(props: PageProps<"/song/[id]">) {
  const { id } = await props.params;
  return <SongView id={id} />;
}
