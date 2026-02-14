import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { apiService, BillingSettingsResponse } from "../services/api";

export default function AdminDashboard() {
  const navigate = useNavigate();
  const [users, setUsers] = useState<any[]>([]);
  const [stats, setStats] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);
  const [creditTarget, setCreditTarget] = useState("");
  const [creditDelta, setCreditDelta] = useState(10);
  const [creditMessage, setCreditMessage] = useState<string | null>(null);
  const [creditBusy, setCreditBusy] = useState(false);
  const [billing, setBilling] = useState<BillingSettingsResponse | null>(null);
  const [billingPrice, setBillingPrice] = useState("0.10");
  const [billingFreeDailyTokens, setBillingFreeDailyTokens] = useState("2500");
  const [billingMessage, setBillingMessage] = useState<string | null>(null);
  const [billingBusy, setBillingBusy] = useState(false);
  const [roleTarget, setRoleTarget] = useState("");
  const [roleValue, setRoleValue] = useState("admin");
  const [roleMessage, setRoleMessage] = useState<string | null>(null);
  const [roleBusy, setRoleBusy] = useState(false);
  const [usageTarget, setUsageTarget] = useState("");
  const [usageMessage, setUsageMessage] = useState<string | null>(null);
  const [usageBusy, setUsageBusy] = useState(false);
  const [promoCode, setPromoCode] = useState("");
  const [promoBonus, setPromoBonus] = useState(5);
  const [promoMaxUses, setPromoMaxUses] = useState(1);
  const [promoExpires, setPromoExpires] = useState("");
  const [promoMessage, setPromoMessage] = useState<string | null>(null);
  const [promoBusy, setPromoBusy] = useState(false);
  const [resetAllDate, setResetAllDate] = useState("");
  const [resetAllMessage, setResetAllMessage] = useState<string | null>(null);
  const [resetAllBusy, setResetAllBusy] = useState(false);

  const loadAdminData = async () => {
    try {
      const [u, s, b] = await Promise.all([
        apiService.listUsers(),
        apiService.getStats(),
        apiService.getBillingSettings(),
      ]);
      setUsers(u);
      setStats(s);
      setBilling(b);
      setBillingPrice(Number(b.token_price_per_1k_credits ?? 0).toFixed(2));
      setBillingFreeDailyTokens(String(b.free_daily_tokens ?? 0));
    } catch (e: any) {
      setError(e?.message || "Failed to load admin data");
    }
  };

  useEffect(() => {
    loadAdminData();
  }, []);

  const userCount = users.length;
  const totalCredits = useMemo(() => users.reduce((sum, u) => sum + (Number(u?.credits) || 0), 0), [users]);

  const handleGrantCredits = async () => {
    setCreditMessage(null);
    setError(null);
    const target = creditTarget.trim();
    if (!target) {
      setCreditMessage("Enter a username or user id.");
      return;
    }
    const delta = Number(creditDelta);
    if (!Number.isFinite(delta) || delta === 0) {
      setCreditMessage("Enter a non-zero credit amount.");
      return;
    }
    setCreditBusy(true);
    try {
      const payload = /^\d+$/.test(target)
        ? { user_id: Number(target), delta }
        : { username: target, delta };
      const res = await apiService.adjustCredits(payload);
      setCreditMessage(`Updated credits for ${res.username || target}. New credits: ${res.credits}.`);
      await loadAdminData();
      setCreditTarget("");
    } catch (e: any) {
      setError(e?.message || "Failed to update credits");
    } finally {
      setCreditBusy(false);
    }
  };

  const handleUpdateBilling = async () => {
    setBillingMessage(null);
    setError(null);
    const parsedPrice = Number.parseFloat(billingPrice);
    const parsedTokens = Number.parseInt(billingFreeDailyTokens, 10);
    if (!Number.isFinite(parsedPrice) || parsedPrice < 0) {
      setBillingMessage("Enter a valid token price.");
      return;
    }
    if (!Number.isFinite(parsedTokens) || parsedTokens < 0) {
      setBillingMessage("Enter a valid free daily token limit.");
      return;
    }
    setBillingBusy(true);
    try {
      const payload: BillingSettingsResponse = {
        token_price_per_1k_credits: Number(parsedPrice.toFixed(2)),
        free_daily_tokens: parsedTokens,
      };
      const res = await apiService.updateBillingSettings(payload);
      setBilling(res);
      setBillingPrice(Number(res.token_price_per_1k_credits ?? 0).toFixed(2));
      setBillingFreeDailyTokens(String(res.free_daily_tokens ?? 0));
      setBillingMessage("Billing settings updated.");
    } catch (e: any) {
      setError(e?.message || "Failed to update billing settings");
    } finally {
      setBillingBusy(false);
    }
  };

  const handleUpdateRole = async () => {
    setRoleMessage(null);
    setError(null);
    const target = roleTarget.trim();
    if (!target) {
      setRoleMessage("Enter a username or user id.");
      return;
    }
    setRoleBusy(true);
    try {
      const payload = /^\d+$/.test(target)
        ? { user_id: Number(target), role: roleValue }
        : { username: target, role: roleValue };
      const res = await apiService.updateRole(payload);
      setRoleMessage(`Role updated for ${res.username || target}: ${res.role}.`);
      await loadAdminData();
      setRoleTarget("");
    } catch (e: any) {
      setError(e?.message || "Failed to update role");
    } finally {
      setRoleBusy(false);
    }
  };

  const handleResetUsage = async () => {
    setUsageMessage(null);
    setError(null);
    const target = usageTarget.trim();
    if (!target) {
      setUsageMessage("Enter a username or user id.");
      return;
    }
    setUsageBusy(true);
    try {
      const payload = /^\d+$/.test(target)
        ? { user_id: Number(target) }
        : { username: target };
      await apiService.resetUsage(payload);
      setUsageMessage(`Daily usage reset for ${target}.`);
      await loadAdminData();
      setUsageTarget("");
    } catch (e: any) {
      setError(e?.message || "Failed to reset usage");
    } finally {
      setUsageBusy(false);
    }
  };

  const handleResetAllUsage = async () => {
    setResetAllMessage(null);
    setError(null);
    setResetAllBusy(true);
    try {
      const date = resetAllDate.trim();
      await apiService.resetUsage({ all_users: true, date: date || undefined });
      setResetAllMessage(`Daily usage reset for all users${date ? ` on ${date}` : ""}.`);
      await loadAdminData();
      setResetAllDate("");
    } catch (e: any) {
      setError(e?.message || "Failed to reset usage for all users");
    } finally {
      setResetAllBusy(false);
    }
  };

  const handleCreatePromo = async () => {
    setPromoMessage(null);
    setError(null);
    const code = promoCode.trim();
    if (!code) {
      setPromoMessage("Enter a promo code.");
      return;
    }
    const bonus = Number(promoBonus);
    if (!Number.isFinite(bonus) || bonus < 0) {
      setPromoMessage("Enter a valid bonus amount.");
      return;
    }
    const maxUses = Number(promoMaxUses);
    if (!Number.isFinite(maxUses) || maxUses < 1) {
      setPromoMessage("Enter a valid max uses value.");
      return;
    }
    setPromoBusy(true);
    try {
      const payload = {
        code,
        bonus_attempts: bonus,
        max_uses: maxUses,
        expires_at: promoExpires.trim() || undefined,
      };
      const res = await apiService.createPromo(payload);
      setPromoMessage(`Promo created: ${res.code}`);
      setPromoCode("");
      setPromoExpires("");
    } catch (e: any) {
      setError(e?.message || "Failed to create promo code");
    } finally {
      setPromoBusy(false);
    }
  };

  return (
    <div className="min-h-screen bg-[#0b0b12] text-white">
      <div className="mx-auto max-w-6xl px-6 py-8">
        <header className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
          <div>
            <div className="text-xs uppercase tracking-[0.3em] text-emerald-300">Control Center</div>
            <h1 className="text-3xl font-semibold">Admin Operations</h1>
            <p className="text-sm text-white/60">Manage credits, roles, usage, and promo codes.</p>
          </div>
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={loadAdminData}
              className="rounded-full border border-white/20 px-4 py-2 text-sm text-white/80 hover:text-white"
            >
              Refresh
            </button>
            <button
              type="button"
              onClick={() => navigate("/dashboard")}
              className="rounded-full bg-white px-4 py-2 text-sm font-semibold text-slate-900"
            >
              Back to dashboard
            </button>
          </div>
        </header>

        {(error || creditMessage || roleMessage || usageMessage || promoMessage || resetAllMessage || billingMessage) && (
          <div className="mt-6 grid gap-2">
            {error && <div className="rounded-xl border border-rose-400/30 bg-rose-500/10 px-4 py-2 text-sm text-rose-100">{error}</div>}
            {creditMessage && <div className="rounded-xl border border-emerald-400/20 bg-emerald-400/10 px-4 py-2 text-sm text-emerald-100">{creditMessage}</div>}
            {roleMessage && <div className="rounded-xl border border-emerald-400/20 bg-emerald-400/10 px-4 py-2 text-sm text-emerald-100">{roleMessage}</div>}
            {usageMessage && <div className="rounded-xl border border-emerald-400/20 bg-emerald-400/10 px-4 py-2 text-sm text-emerald-100">{usageMessage}</div>}
            {promoMessage && <div className="rounded-xl border border-emerald-400/20 bg-emerald-400/10 px-4 py-2 text-sm text-emerald-100">{promoMessage}</div>}
            {resetAllMessage && <div className="rounded-xl border border-emerald-400/20 bg-emerald-400/10 px-4 py-2 text-sm text-emerald-100">{resetAllMessage}</div>}
            {billingMessage && <div className="rounded-xl border border-emerald-400/20 bg-emerald-400/10 px-4 py-2 text-sm text-emerald-100">{billingMessage}</div>}
          </div>
        )}

        <div className="mt-6 grid gap-6 lg:grid-cols-[1.15fr_0.85fr]">
          <section className="space-y-6">
            <div className="grid gap-4 md:grid-cols-3">
              <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
                <div className="text-xs uppercase tracking-[0.2em] text-white/50">Total users</div>
                <div className="mt-2 text-2xl font-semibold">{userCount}</div>
              </div>
              <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
                <div className="text-xs uppercase tracking-[0.2em] text-white/50">Total credits</div>
                <div className="mt-2 text-2xl font-semibold">{totalCredits.toFixed(2)}</div>
              </div>
              <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
                <div className="text-xs uppercase tracking-[0.2em] text-white/50">Simulations today</div>
                <div className="mt-2 text-2xl font-semibold">{stats?.used_today ?? 0}</div>
              </div>
            </div>

            <div className="rounded-2xl border border-white/10 bg-black/60 p-4">
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-semibold">Simulation stats</h3>
                <span className="text-xs text-white/50">Total: {stats?.total_simulations ?? 0}</span>
              </div>
              <div className="mt-3 grid gap-3 text-sm text-white/70 md:grid-cols-2">
                <div className="rounded-xl border border-white/10 bg-white/5 p-3">
                  Total simulations: <span className="text-white">{stats?.total_simulations ?? 0}</span>
                </div>
                <div className="rounded-xl border border-white/10 bg-white/5 p-3">
                  Used today: <span className="text-white">{stats?.used_today ?? 0}</span>
                </div>
              </div>
            </div>

            <div className="rounded-2xl border border-white/10 bg-black/60 p-4">
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-semibold">Users</h3>
                <span className="text-xs text-white/50">{users.length} records</span>
              </div>
              <div className="mt-3 max-h-[420px] overflow-y-auto">
                <table className="w-full text-sm">
                  <thead className="text-xs uppercase text-white/50">
                    <tr>
                      <th className="py-2 text-left">ID</th>
                      <th className="py-2 text-left">Username</th>
                      <th className="py-2 text-left">Role</th>
                      <th className="py-2 text-left">Credits</th>
                    </tr>
                  </thead>
                  <tbody className="text-white/80">
                    {users.map((u) => (
                      <tr key={u.id} className="border-t border-white/5">
                        <td className="py-2">{u.id}</td>
                        <td className="py-2">{u.username}</td>
                        <td className="py-2">{u.role}</td>
                        <td className="py-2">{Number(u.credits ?? 0).toFixed(2)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </section>

          <section className="space-y-5">
            <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
              <h3 className="text-sm font-semibold">Token billing</h3>
              <p className="mt-1 text-xs text-white/60">Set how many credits are charged per 1000 tokens and the free daily token quota.</p>
              <div className="mt-3 space-y-2">
                <label className="text-xs text-white/60">Credits per 1000 tokens</label>
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  value={billingPrice}
                  onChange={(e) => setBillingPrice(e.target.value)}
                  className="w-full rounded-lg border border-white/10 bg-black/40 px-3 py-2 text-sm"
                />
                <label className="text-xs text-white/60">Free daily tokens</label>
                <input
                  type="number"
                  min="0"
                  step="1"
                  value={billingFreeDailyTokens}
                  onChange={(e) => setBillingFreeDailyTokens(e.target.value)}
                  className="w-full rounded-lg border border-white/10 bg-black/40 px-3 py-2 text-sm"
                />
                <button
                  type="button"
                  onClick={handleUpdateBilling}
                  disabled={billingBusy}
                  className="w-full rounded-lg bg-white px-3 py-2 text-sm font-semibold text-slate-900 disabled:opacity-60"
                >
                  {billingBusy ? "Updating..." : "Update billing"}
                </button>
                <div className="text-xs text-white/50">
                  Current: {Number(billing?.token_price_per_1k_credits ?? 0).toFixed(2)} credits / 1000 tokens, {billing?.free_daily_tokens ?? 0} free tokens/day
                </div>
              </div>
            </div>

            <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
              <h3 className="text-sm font-semibold">Credits</h3>
              <div className="mt-3 space-y-2">
                <input
                  type="text"
                  placeholder="username or user id"
                  value={creditTarget}
                  onChange={(e) => setCreditTarget(e.target.value)}
                  className="w-full rounded-lg border border-white/10 bg-black/40 px-3 py-2 text-sm"
                />
                <input
                  type="number"
                  step="0.01"
                  value={creditDelta}
                  onChange={(e) => setCreditDelta(Number.parseFloat(e.target.value))}
                  className="w-full rounded-lg border border-white/10 bg-black/40 px-3 py-2 text-sm"
                />
                <button
                  type="button"
                  onClick={handleGrantCredits}
                  disabled={creditBusy}
                  className="w-full rounded-lg bg-white px-3 py-2 text-sm font-semibold text-slate-900 disabled:opacity-60"
                >
                  {creditBusy ? "Updating..." : "Apply"}
                </button>
              </div>
            </div>

            <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
              <h3 className="text-sm font-semibold">Roles</h3>
              <div className="mt-3 space-y-2">
                <input
                  type="text"
                  placeholder="username or user id"
                  value={roleTarget}
                  onChange={(e) => setRoleTarget(e.target.value)}
                  className="w-full rounded-lg border border-white/10 bg-black/40 px-3 py-2 text-sm"
                />
                <select
                  value={roleValue}
                  onChange={(e) => setRoleValue(e.target.value)}
                  className="w-full rounded-lg border border-white/10 bg-black/40 px-3 py-2 text-sm"
                >
                  <option value="admin">admin</option>
                  <option value="developer">developer</option>
                  <option value="user">user</option>
                </select>
                <button
                  type="button"
                  onClick={handleUpdateRole}
                  disabled={roleBusy}
                  className="w-full rounded-lg bg-white px-3 py-2 text-sm font-semibold text-slate-900 disabled:opacity-60"
                >
                  {roleBusy ? "Updating..." : "Apply"}
                </button>
              </div>
            </div>

            <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
              <h3 className="text-sm font-semibold">Usage reset</h3>
              <div className="mt-3 space-y-2">
                <input
                  type="text"
                  placeholder="username or user id"
                  value={usageTarget}
                  onChange={(e) => setUsageTarget(e.target.value)}
                  className="w-full rounded-lg border border-white/10 bg-black/40 px-3 py-2 text-sm"
                />
                <button
                  type="button"
                  onClick={handleResetUsage}
                  disabled={usageBusy}
                  className="w-full rounded-lg bg-white px-3 py-2 text-sm font-semibold text-slate-900 disabled:opacity-60"
                >
                  {usageBusy ? "Resetting..." : "Reset"}
                </button>
                <div className="mt-3 flex gap-2">
                  <input
                    type="date"
                    value={resetAllDate}
                    onChange={(e) => setResetAllDate(e.target.value)}
                    className="flex-1 rounded-lg border border-white/10 bg-black/40 px-3 py-2 text-sm"
                  />
                  <button
                    type="button"
                    onClick={handleResetAllUsage}
                    disabled={resetAllBusy}
                    className="rounded-lg border border-white/20 px-3 py-2 text-sm text-white/80 disabled:opacity-60"
                  >
                    {resetAllBusy ? "Resetting..." : "Reset all"}
                  </button>
                </div>
              </div>
            </div>

            <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
              <h3 className="text-sm font-semibold">Promo codes</h3>
              <div className="mt-3 space-y-2">
                <input
                  type="text"
                  placeholder="code"
                  value={promoCode}
                  onChange={(e) => setPromoCode(e.target.value)}
                  className="w-full rounded-lg border border-white/10 bg-black/40 px-3 py-2 text-sm"
                />
                <div className="grid grid-cols-3 gap-2">
                  <input
                    type="number"
                    value={promoBonus}
                    onChange={(e) => setPromoBonus(Number(e.target.value))}
                    className="rounded-lg border border-white/10 bg-black/40 px-3 py-2 text-sm"
                  />
                  <input
                    type="number"
                    value={promoMaxUses}
                    onChange={(e) => setPromoMaxUses(Number(e.target.value))}
                    className="rounded-lg border border-white/10 bg-black/40 px-3 py-2 text-sm"
                  />
                  <input
                    type="date"
                    value={promoExpires}
                    onChange={(e) => setPromoExpires(e.target.value)}
                    className="rounded-lg border border-white/10 bg-black/40 px-3 py-2 text-sm"
                  />
                </div>
                <button
                  type="button"
                  onClick={handleCreatePromo}
                  disabled={promoBusy}
                  className="w-full rounded-lg bg-white px-3 py-2 text-sm font-semibold text-slate-900 disabled:opacity-60"
                >
                  {promoBusy ? "Creating..." : "Create promo"}
                </button>
              </div>
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}
