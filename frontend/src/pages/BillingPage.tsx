import { useState } from "react";
import { CreditCard, User as UserIcon, Building2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "../components/atoms/Button";
import { Input } from "../components/atoms/Input";
import { FormField } from "../components/molecules/FormField";
import { useAuth } from "../auth/useAuth";
import { authenticatedJson } from "../utils/authenticatedApi";
import API_BASE_URL from "../utils/api";

function toSlug(value: string): string {
  return (
    value
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "") || "team"
  );
}

export default function BillingPage() {
  const { user } = useAuth();
  const [busy, setBusy] = useState<string | null>(null);
  const [individualAmount, setIndividualAmount] = useState(1);
  const [teamName, setTeamName] = useState("");
  const [teamSlug, setTeamSlug] = useState("");
  const [seats, setSeats] = useState(2);

  const go = async (label: string, body: Record<string, unknown>) => {
    setBusy(label);
    try {
      const { url } = await authenticatedJson<{ url: string }>(
        `${API_BASE_URL}/api/billing/checkout`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        },
      );
      window.location.href = url; // hand off to Stripe Checkout
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "Could not start checkout",
      );
      setBusy(null);
    }
  };

  const openPortal = async () => {
    setBusy("portal");
    try {
      const { url } = await authenticatedJson<{ url: string }>(
        `${API_BASE_URL}/api/billing/portal`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            owner_type: "user",
            owner_id: user?.userId,
            return_url: "/settings/billing",
          }),
        },
      );
      window.location.href = url;
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "No subscription to manage yet",
      );
      setBusy(null);
    }
  };

  const cardClass =
    "rounded border border-border bg-surface-raised p-5 dark:border-border-dark dark:bg-surface-dark-raised";

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-3 border-b border-border bg-surface px-6 py-6 dark:border-border-dark dark:bg-surface-dark">
        <CreditCard className="h-5 w-5 text-text-secondary dark:text-text-secondary-dark" />
        <div>
          <h1 className="font-display text-3xl font-bold tracking-tight text-text-primary dark:text-text-primary-dark">
            Billing
          </h1>
          <p className="text-xs text-text-secondary dark:text-text-secondary-dark">
            Subscribe to unlock projects, run history, and team organizations.
          </p>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-6">
        <div className="mx-auto grid max-w-4xl gap-5 sm:grid-cols-2">
          {/* Individual */}
          <div className={cardClass}>
            <div className="mb-2 flex items-center gap-2">
              <UserIcon className="h-4 w-4 text-primary dark:text-primary-light" />
              <h2 className="text-sm font-semibold text-text-primary dark:text-text-primary-dark">
                Individual
              </h2>
            </div>
            <p className="mb-4 text-xs text-text-secondary dark:text-text-secondary-dark">
              Pay what you want, $1/mo minimum. Projects, full run history,
              re-run from last failed, 500 webhook runs/day with logs.
            </p>
            <FormField label="Monthly amount (USD, $1 min)">
              <Input
                type="number"
                min={1}
                value={individualAmount}
                onChange={(e) =>
                  setIndividualAmount(Math.max(1, Number(e.target.value) || 1))
                }
              />
            </FormField>
            <Button
              fullWidth
              className="mt-4"
              loading={busy === "individual"}
              onClick={() =>
                go("individual", {
                  plan: "individual",
                  seats: individualAmount,
                })
              }
            >
              Subscribe — ${individualAmount}/mo
            </Button>
          </div>

          {/* Teams */}
          <div className={cardClass}>
            <div className="mb-2 flex items-center gap-2">
              <Building2 className="h-4 w-4 text-primary dark:text-primary-light" />
              <h2 className="text-sm font-semibold text-text-primary dark:text-text-primary-dark">
                Teams
              </h2>
            </div>
            <p className="mb-4 text-xs text-text-secondary dark:text-text-secondary-dark">
              $5 / member / mo (max 100). Everything in Individual plus
              organizations, teams, and shared workspaces. The org is created
              once payment completes.
            </p>
            <FormField label="Organization name" required>
              <Input
                value={teamName}
                onChange={(e) => {
                  setTeamName(e.target.value);
                  setTeamSlug(toSlug(e.target.value));
                }}
                placeholder="Acme QA"
              />
            </FormField>
            <FormField label="Slug" required>
              <Input
                value={teamSlug}
                onChange={(e) => setTeamSlug(e.target.value)}
                placeholder="acme-qa"
              />
            </FormField>
            <FormField label="Seats">
              <Input
                type="number"
                min={1}
                max={100}
                value={seats}
                onChange={(e) =>
                  setSeats(
                    Math.min(100, Math.max(1, Number(e.target.value) || 1)),
                  )
                }
              />
            </FormField>
            <Button
              fullWidth
              className="mt-4"
              loading={busy === "team"}
              disabled={!teamName.trim() || !teamSlug.trim()}
              onClick={() =>
                go("team", {
                  plan: "team",
                  seats,
                  org_name: teamName.trim(),
                  org_slug: teamSlug.trim(),
                })
              }
            >
              Create Team — ${seats * 5}/mo
            </Button>
          </div>
        </div>

        <div className="mx-auto mt-5 max-w-4xl">
          <Button
            variant="outline"
            loading={busy === "portal"}
            onClick={openPortal}
          >
            Manage billing
          </Button>
          <p className="mt-2 text-xs text-text-muted dark:text-text-muted-dark">
            Test mode — use card 4242 4242 4242 4242, any future date and CVC.
          </p>
        </div>
      </div>
    </div>
  );
}
