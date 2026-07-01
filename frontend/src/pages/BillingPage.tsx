import { useCallback, useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import {
  CreditCard,
  User as UserIcon,
  Building2,
  Check,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "../components/atoms/Button";
import { Input } from "../components/atoms/Input";
import { FormField } from "../components/molecules/FormField";
import { useAuth } from "../auth/useAuth";
import { authenticatedJson } from "../utils/authenticatedApi";
import API_BASE_URL from "../utils/api";

interface MyBilling {
  plan: string;
  planName: string;
  status: string | null;
  currentPeriodEnd: string | null;
  hasSubscription: boolean;
  webhookRunsToday: number;
  webhookRunsPerDay: number | null;
  persistRunHistory: boolean;
  persistWebhookLogs: boolean;
  canCreateProjects: boolean;
  canCreateOrgs: boolean;
  canRerunFromFailed: boolean;
}

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
  const [searchParams, setSearchParams] = useSearchParams();
  const [busy, setBusy] = useState<string | null>(null);
  const [me, setMe] = useState<MyBilling | null>(null);
  const [individualAmount, setIndividualAmount] = useState(1);
  const [teamName, setTeamName] = useState("");
  const [teamSlug, setTeamSlug] = useState("");
  const [seats, setSeats] = useState(2);

  const loadMe = useCallback(async () => {
    try {
      setMe(
        await authenticatedJson<MyBilling>(`${API_BASE_URL}/api/billing/usage`),
      );
    } catch {
      /* leave as null */
    }
  }, []);

  useEffect(() => {
    void loadMe();
  }, [loadMe]);

  // Handle the Stripe redirect. The subscription lands via webhook, which can
  // arrive a moment after redirect — poll a few times so the plan shows.
  useEffect(() => {
    const status = searchParams.get("status");
    if (!status) return;
    if (status === "success") {
      toast.success("Payment received — activating your subscription…");
      // The subscription lands via webhook, which can arrive just after the
      // redirect — poll a few times until it shows.
      const poll = async (tries: number) => {
        const cur = await authenticatedJson<MyBilling>(
          `${API_BASE_URL}/api/billing/usage`,
        ).catch(() => null);
        if (cur) setMe(cur);
        if (!cur?.hasSubscription && tries < 5) {
          setTimeout(() => void poll(tries + 1), 1500);
        }
      };
      void poll(0);
    } else if (status === "cancel") {
      toast.info("Checkout canceled.");
    }
    setSearchParams({}, { replace: true });
  }, [searchParams, setSearchParams, loadMe]);

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
        {me && (
          <div className="mx-auto mb-5 flex max-w-4xl items-center justify-between gap-3 rounded border border-border bg-surface-raised px-4 py-3 dark:border-border-dark dark:bg-surface-dark-raised">
            <div className="flex items-center gap-2">
              {me.hasSubscription && me.status === "active" && (
                <Check className="h-4 w-4 text-status-success" />
              )}
              <span className="text-sm text-text-primary dark:text-text-primary-dark">
                Current plan: <strong>{me.planName}</strong>
                {me.status ? (
                  <span className="text-text-secondary dark:text-text-secondary-dark">
                    {" "}
                    · {me.status}
                  </span>
                ) : null}
              </span>
            </div>
            {me.currentPeriodEnd && (
              <span className="text-xs text-text-muted dark:text-text-muted-dark">
                Renews {new Date(me.currentPeriodEnd).toLocaleDateString()}
              </span>
            )}
          </div>
        )}

        {me && (
          <div className="mx-auto mb-5 max-w-4xl rounded border border-border bg-surface-raised p-4 dark:border-border-dark dark:bg-surface-dark-raised">
            <h2 className="mb-3 text-sm font-semibold text-text-primary dark:text-text-primary-dark">
              Usage &amp; limits
            </h2>
            {/* Webhook runs/day meter */}
            <div className="mb-3">
              <div className="mb-1 flex justify-between text-xs text-text-secondary dark:text-text-secondary-dark">
                <span>Webhook runs today</span>
                <span>
                  {me.webhookRunsToday}
                  {me.webhookRunsPerDay === null
                    ? " (unlimited)"
                    : ` / ${me.webhookRunsPerDay}`}
                </span>
              </div>
              {me.webhookRunsPerDay !== null && (
                <div className="h-1.5 w-full overflow-hidden rounded-full bg-surface-overlay dark:bg-surface-dark-overlay">
                  <div
                    className="h-full rounded-full bg-primary dark:bg-primary-light"
                    style={{
                      width: `${Math.min(100, (me.webhookRunsToday / me.webhookRunsPerDay) * 100)}%`,
                    }}
                  />
                </div>
              )}
            </div>
            {/* Capability checklist */}
            <ul className="grid grid-cols-2 gap-x-6 gap-y-1 text-xs">
              {[
                ["Projects", me.canCreateProjects],
                ["Full run history", me.persistRunHistory],
                ["Webhook run logs", me.persistWebhookLogs],
                ["Re-run from last failed", me.canRerunFromFailed],
                ["Organizations & teams", me.canCreateOrgs],
              ].map(([label, on]) => (
                <li
                  key={label as string}
                  className="flex items-center gap-1.5 text-text-secondary dark:text-text-secondary-dark"
                >
                  {on ? (
                    <Check className="h-3.5 w-3.5 text-status-success" />
                  ) : (
                    <X className="h-3.5 w-3.5 text-text-muted dark:text-text-muted-dark" />
                  )}
                  {label}
                </li>
              ))}
            </ul>
          </div>
        )}

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
