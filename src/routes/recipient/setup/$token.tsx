import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { completeRecipientSetup, previewRecipientSetup } from "@/functions/recipient";
import { Button, Card, ErrorText, Field, Notice, PageHeader, inputClass } from "@/components/ui";

/** A first-time recipient sets a password from the one-time link in their alert (decision 45). */
export const Route = createFileRoute("/recipient/setup/$token")({
  loader: async ({ params }) => previewRecipientSetup({ data: { token: params.token } }),
  component: Setup,
});

function Setup() {
  const preview = Route.useLoaderData();
  const { token } = Route.useParams();
  const navigate = useNavigate();
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  if (!preview.ok)
    return (
      <Notice tone="quiet" title="This link can't be used">
        {preview.message}
      </Notice>
    );
  return (
    <>
      <PageHeader
        eyebrow="Shared with you"
        title="Set up your sign-in"
        lede="A hospice shared a packet with you in Zeporah. Choose a password to read it."
      />
      <Card>
        <form
          className="space-y-4"
          onSubmit={async (e) => {
            e.preventDefault();
            setBusy(true);
            const r = await completeRecipientSetup({ data: { token, password } });
            setBusy(false);
            if (r.ok) await navigate({ to: "/recipient" });
            else setError(r.message);
          }}
        >
          <p>
            For <strong>{preview.data.name}</strong> ({preview.data.email})
          </p>
          <Field label="Password" hint="At least 12 characters.">
            {(id, d) => (
              <input
                id={id}
                aria-describedby={d}
                type="password"
                autoComplete="new-password"
                required
                className={inputClass}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            )}
          </Field>
          <ErrorText error={error} />
          <Button type="submit" disabled={busy}>
            Set password and continue
          </Button>
        </form>
      </Card>
    </>
  );
}
