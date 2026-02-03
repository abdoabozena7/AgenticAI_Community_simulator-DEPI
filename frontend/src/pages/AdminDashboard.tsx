import { useEffect, useState } from "react";
import { apiService } from "../services/api";

export default function AdminDashboard() {
  const [users, setUsers] = useState<any[]>([]);
  const [stats, setStats] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);
  const [creditTarget, setCreditTarget] = useState("");
  const [creditDelta, setCreditDelta] = useState(10);
  const [creditMessage, setCreditMessage] = useState<string | null>(null);
  const [creditBusy, setCreditBusy] = useState(false);
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
      const u = await apiService.listUsers();
      const s = await apiService.getStats();
      setUsers(u);
      setStats(s);
    } catch (e: any) {
      setError(e?.message || "Failed to load admin data");
    }
  };

  useEffect(() => {
    loadAdminData();
  }, []);

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
    <div style={{ padding: 16 }}>
      <h2>Admin Dashboard</h2>

      {error && <p style={{ color: "red" }}>{error}</p>}
      {creditMessage && <p style={{ color: "#0f0" }}>{creditMessage}</p>}
      {promoMessage && <p style={{ color: "#0f0" }}>{promoMessage}</p>}
      {resetAllMessage && <p style={{ color: "#0f0" }}>{resetAllMessage}</p>}

      <div style={{ display: "flex", gap: 8, marginBottom: 12 }}>
        <button onClick={loadAdminData}>Refresh</button>
      </div>

      <h3>Stats</h3>
      <pre style={{ background: "#111", color: "#0f0", padding: 12 }}>
        {JSON.stringify(stats, null, 2)}
      </pre>

      <h3>Grant Credits</h3>
      <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 12 }}>
        <input
          type="text"
          placeholder="username or user id"
          value={creditTarget}
          onChange={(e) => setCreditTarget(e.target.value)}
          style={{ flex: 1, padding: 8, borderRadius: 6, border: "1px solid #333" }}
        />
        <input
          type="number"
          value={creditDelta}
          onChange={(e) => setCreditDelta(Number(e.target.value))}
          style={{ width: 120, padding: 8, borderRadius: 6, border: "1px solid #333" }}
        />
        <button onClick={handleGrantCredits} disabled={creditBusy}>
          {creditBusy ? "Updating..." : "Apply"}
        </button>
      </div>

      <h3>Update Role</h3>
      <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 12 }}>
        <input
          type="text"
          placeholder="username or user id"
          value={roleTarget}
          onChange={(e) => setRoleTarget(e.target.value)}
          style={{ flex: 1, padding: 8, borderRadius: 6, border: "1px solid #333" }}
        />
        <select
          value={roleValue}
          onChange={(e) => setRoleValue(e.target.value)}
          style={{ padding: 8, borderRadius: 6, border: "1px solid #333" }}
        >
          <option value="admin">admin</option>
          <option value="user">user</option>
        </select>
        <button onClick={handleUpdateRole} disabled={roleBusy}>
          {roleBusy ? "Updating..." : "Apply"}
        </button>
      </div>
      {roleMessage && <p style={{ color: "#0f0" }}>{roleMessage}</p>}

      <h3>Reset Daily Usage</h3>
      <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 12 }}>
        <input
          type="text"
          placeholder="username or user id"
          value={usageTarget}
          onChange={(e) => setUsageTarget(e.target.value)}
          style={{ flex: 1, padding: 8, borderRadius: 6, border: "1px solid #333" }}
        />
        <button onClick={handleResetUsage} disabled={usageBusy}>
          {usageBusy ? "Resetting..." : "Reset"}
        </button>
      </div>
      {usageMessage && <p style={{ color: "#0f0" }}>{usageMessage}</p>}

      <h3>Reset Usage (All Users)</h3>
      <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 12 }}>
        <input
          type="date"
          value={resetAllDate}
          onChange={(e) => setResetAllDate(e.target.value)}
          style={{ padding: 8, borderRadius: 6, border: "1px solid #333" }}
        />
        <button onClick={handleResetAllUsage} disabled={resetAllBusy}>
          {resetAllBusy ? "Resetting..." : "Reset All"}
        </button>
      </div>

      <h3>Create Promo Code</h3>
      <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 12 }}>
        <input
          type="text"
          placeholder="code"
          value={promoCode}
          onChange={(e) => setPromoCode(e.target.value)}
          style={{ flex: 1, padding: 8, borderRadius: 6, border: "1px solid #333" }}
        />
        <input
          type="number"
          value={promoBonus}
          onChange={(e) => setPromoBonus(Number(e.target.value))}
          style={{ width: 120, padding: 8, borderRadius: 6, border: "1px solid #333" }}
        />
        <input
          type="number"
          value={promoMaxUses}
          onChange={(e) => setPromoMaxUses(Number(e.target.value))}
          style={{ width: 120, padding: 8, borderRadius: 6, border: "1px solid #333" }}
        />
        <input
          type="date"
          value={promoExpires}
          onChange={(e) => setPromoExpires(e.target.value)}
          style={{ padding: 8, borderRadius: 6, border: "1px solid #333" }}
        />
        <button onClick={handleCreatePromo} disabled={promoBusy}>
          {promoBusy ? "Creating..." : "Create"}
        </button>
      </div>

      <h3>Users</h3>
      <pre style={{ background: "#111", color: "#0f0", padding: 12 }}>
        {JSON.stringify(users, null, 2)}
      </pre>
    </div>
  );
}
