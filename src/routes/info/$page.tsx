import { Link, createFileRoute, notFound } from "@tanstack/react-router";
import { AppFooter } from "@/components/footer";
import { Notice } from "@/components/ui";

/**
 * Placeholder pages behind the footer links. They say plainly that the policy isn't written yet,
 * so nothing here can be mistaken for a real privacy notice, terms or accessibility statement.
 */
const PAGES = {
  privacy: {
    title: "Privacy",
    body: "Zeporah's privacy notice hasn't been written yet. This is a synthetic prototype: every person and record in it is made up, and nothing you do here is sent outside this computer.",
  },
  terms: {
    title: "Terms of use",
    body: "Zeporah's terms of use haven't been written yet. This synthetic prototype is for internal review only.",
  },
  accessibility: {
    title: "Accessibility",
    body: "An accessibility statement hasn't been written yet. Zeporah is being reviewed against accessibility guidelines, and we don't claim it conforms to any standard. If something is hard to use, tell your care team so they can pass it on.",
  },
  support: {
    title: "Support",
    body: "For help with Zeporah, contact your hospice care team. If someone needs urgent help, call 911 or your hospice's 24-hour line.",
  },
} as const;

export const Route = createFileRoute("/info/$page")({
  loader: ({ params }) => {
    const p = PAGES[params.page as keyof typeof PAGES];
    if (!p) throw notFound();
    return p;
  },
  head: ({ loaderData }) => ({ meta: [{ title: `${loaderData?.title ?? "Information"} — Zeporah` }] }),
  component: Info,
});

function Info() {
  const p = Route.useLoaderData();
  return (
    <main id="main" tabIndex={-1} className="mx-auto max-w-[30rem] px-5 py-10 sm:py-14">
      <Link to="/" className="font-display text-2xl">
        Zeporah<span className="text-clay">.</span>
      </Link>
      <h1 className="mt-10 text-3xl">{p.title}</h1>
      <div className="mt-6">
        <Notice tone="ochre" title="Not written yet">
          {p.body}
        </Notice>
      </div>
      <AppFooter />
    </main>
  );
}
