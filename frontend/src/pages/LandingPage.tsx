import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { apiService, UserMe } from "@/services/api";
import { Input } from "@/components/ui/input";

const ideaList = [
  {
    title: { en: "Agent Insights Hub", ar: "ظ…ط±ظƒط² ط±ط¤ظ‰ ط§ظ„ظˆظƒظ„ط§ط،" },
    tag: { en: "Simulation", ar: "ظ…ط­ط§ظƒط§ط©" },
    description: {
      en: "Multi-agent feedback for a SaaS launch in MENA markets.",
      ar: "ط¢ط±ط§ط، ظ…طھط¹ط¯ط¯ط© ط§ظ„ظˆظƒظ„ط§ط، ظ„ط¥ط·ظ„ط§ظ‚ SaaS ظپظٹ ط£ط³ظˆط§ظ‚ ط§ظ„ط´ط±ظ‚ ط§ظ„ط£ظˆط³ط· ظˆط´ظ…ط§ظ„ ط¥ظپط±ظٹظ‚ظٹط§.",
    },
    prompt: {
      en: "Agent insights hub for SaaS launches in MENA markets",
      ar: "ظ…ط±ظƒط² ط±ط¤ظ‰ ط§ظ„ظˆظƒظ„ط§ط، ظ„ط¥ط·ظ„ط§ظ‚ط§طھ SaaS ظپظٹ ط£ط³ظˆط§ظ‚ ط§ظ„ط´ط±ظ‚ ط§ظ„ط£ظˆط³ط· ظˆط´ظ…ط§ظ„ ط¥ظپط±ظٹظ‚ظٹط§",
    },
  },
  {
    title: { en: "Retail Demand Pulse", ar: "ظ†ط¨ط¶ ط§ظ„ط·ظ„ط¨ ظپظٹ ط§ظ„طھط¬ط²ط¦ط©" },
    tag: { en: "Research", ar: "ط£ط¨ط­ط§ط«" },
    description: {
      en: "Market signals for retail pricing automation.",
      ar: "ط¥ط´ط§ط±ط§طھ ط§ظ„ط³ظˆظ‚ ظ„ط£طھظ…طھط© طھط³ط¹ظٹط± ط§ظ„طھط¬ط²ط¦ط©.",
    },
    prompt: {
      en: "Retail demand pulse for pricing automation",
      ar: "ظ†ط¨ط¶ ط§ظ„ط·ظ„ط¨ ظپظٹ ط§ظ„طھط¬ط²ط¦ط© ظ„ط£طھظ…طھط© ط§ظ„طھط³ط¹ظٹط±",
    },
  },
  {
    title: { en: "Idea Court Draft", ar: "ظ…ط³ظˆط¯ط© ظ…ط­ظƒظ…ط© ط§ظ„ط£ظپظƒط§ط±" },
    tag: { en: "Debate", ar: "ظ…ظ†ط§ط¸ط±ط©" },
    description: {
      en: "Run pro/con arguments on a new fintech feature.",
      ar: "ط·ط±ط­ ط­ط¬ط¬ ظ…ط¤ظٹط¯ط© ظˆظ…ط¹ط§ط±ط¶ط© ظ„ظ…ظٹط²ط© ظ…ط§ظ„ظٹط© طھظ‚ظ†ظٹط© ط¬ط¯ظٹط¯ط©.",
    },
    prompt: {
      en: "Debate a new fintech feature for subscription pricing",
      ar: "ظ…ظ†ط§ط¸ط±ط© ط­ظˆظ„ ظ…ظٹط²ط© ظ…ط§ظ„ظٹط© طھظ‚ظ†ظٹط© ط¬ط¯ظٹط¯ط© ظ„طھط³ط¹ظٹط± ط§ظ„ط§ط´طھط±ط§ظƒط§طھ",
    },
  },
];

const templates = [
  {
    title: { en: "Launch Readiness", ar: "ط¬ط§ظ‡ط²ظٹط© ط§ظ„ط¥ط·ظ„ط§ظ‚" },
    description: {
      en: "Validate a new product idea with agent feedback.",
      ar: "طھط­ظ‚ظ‚ ظ…ظ† ظپظƒط±ط© ظ…ظ†طھط¬ ط¬ط¯ظٹط¯ط© ط¹ط¨ط± ظ…ظ„ط§ط­ط¸ط§طھ ط§ظ„ظˆظƒظ„ط§ط،.",
    },
  },
  {
    title: { en: "Market Research", ar: "ط£ط¨ط­ط§ط« ط§ظ„ط³ظˆظ‚" },
    description: {
      en: "Summarize demand, competition, and gaps.",
      ar: "طھظ„ط®ظٹطµ ط§ظ„ط·ظ„ط¨ ظˆط§ظ„ظ…ظ†ط§ظپط³ط© ظˆط§ظ„ظپط¬ظˆط§طھ.",
    },
  },
  {
    title: { en: "Idea Court", ar: "ظ…ط­ظƒظ…ط© ط§ظ„ط£ظپظƒط§ط±" },
    description: {
      en: "Run a debate between advocates and skeptics.",
      ar: "ظ…ظ†ط§ط¸ط±ط© ط¨ظٹظ† ط§ظ„ظ…ط¤ظٹط¯ظٹظ† ظˆط§ظ„ظ…طھط´ظƒظƒظٹظ†.",
    },
  },
];

const LandingPage = () => {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [user, setUser] = useState<UserMe | null>(null);
  const [quickIdea, setQuickIdea] = useState("");
  const [showIdeaActions, setShowIdeaActions] = useState(false);
  const [showProfileMenu, setShowProfileMenu] = useState(false);
  const [promo, setPromo] = useState("");
  const [redeemMessage, setRedeemMessage] = useState<string | null>(null);
  const [promoteSecret, setPromoteSecret] = useState("");
  const [promoteMessage, setPromoteMessage] = useState<string | null>(null);
  const [promoteBusy, setPromoteBusy] = useState(false);
  const [creditNotice, setCreditNotice] = useState<string | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const profileButtonRef = useRef<HTMLButtonElement | null>(null);
  const [photoError, setPhotoError] = useState(false);
  const [appSettings, setAppSettings] = useState(() => {
    if (typeof window === "undefined") {
      return { language: "en" as "en" | "ar", theme: "dark" as "dark" | "light" };
    }
    try {
      const saved = window.localStorage.getItem("appSettings");
      if (!saved) return { language: "en" as "en" | "ar", theme: "dark" as "dark" | "light" };
      const parsed = JSON.parse(saved);
      return {
        language: parsed?.language === "ar" ? "ar" : "en",
        theme: parsed?.theme === "light" ? "light" : "dark",
      } as { language: "en" | "ar"; theme: "dark" | "light" };
    } catch {
      return { language: "en" as "en" | "ar", theme: "dark" as "dark" | "light" };
    }
  });
  const [profileSettings, setProfileSettings] = useState(() => {
    if (typeof window === "undefined") {
      return { name: "", email: "", photo: "" };
    }
    try {
      const saved = window.localStorage.getItem("profileSettings");
      if (!saved) return { name: "", email: "", photo: "" };
      const parsed = JSON.parse(saved);
      return {
        name: typeof parsed?.name === "string" ? parsed.name : "",
        email: typeof parsed?.email === "string" ? parsed.email : "",
        photo: typeof parsed?.photo === "string" ? parsed.photo : "",
      };
    } catch {
      return { name: "", email: "", photo: "" };
    }
  });

  useEffect(() => {
    const fetchMe = async () => {
      try {
        const me = await apiService.getMe();
        setUser(me);
      } catch {
        navigate("/?auth=login");
      } finally {
        setLoading(false);
      }
    };
    fetchMe();
  }, [navigate]);

  useEffect(() => {
    if (typeof document === "undefined") return;
    const root = document.documentElement;
    root.lang = appSettings.language;
    root.dir = appSettings.language === "ar" ? "rtl" : "ltr";
    root.classList.toggle("rtl", appSettings.language === "ar");
    root.classList.toggle("lang-ar", appSettings.language === "ar");
    root.classList.remove("theme-dark", "theme-light");
    root.classList.add(`theme-${appSettings.theme}`);
    try {
      const saved = window.localStorage.getItem("appSettings");
      const parsed = saved ? JSON.parse(saved) : {};
      window.localStorage.setItem("appSettings", JSON.stringify({ ...parsed, ...appSettings }));
    } catch {
      // ignore
    }
  }, [appSettings]);

  useEffect(() => {
    if (!profileSettings.photo) {
      setPhotoError(false);
      return;
    }
    setPhotoError(false);
  }, [profileSettings.photo]);

  useEffect(() => {
    if (!showProfileMenu) return;
    const handleClick = (event: MouseEvent) => {
      const target = event.target as Node;
      if (menuRef.current?.contains(target)) return;
      if (profileButtonRef.current?.contains(target)) return;
      setShowProfileMenu(false);
    };
    window.addEventListener("mousedown", handleClick);
    return () => window.removeEventListener("mousedown", handleClick);
  }, [showProfileMenu]);

  useEffect(() => {
    if (!quickIdea.trim()) {
      setShowIdeaActions(false);
    }
  }, [quickIdea]);

  const userInitial = useMemo(() => {
    if (!user?.username) return "U";
    return user.username.slice(0, 1).toUpperCase();
  }, [user?.username]);

  const displayName = profileSettings.name || user?.username || "User";
  const displayEmail = profileSettings.email || "";

  const t = (en: string, ar: string) => (appSettings.language === "ar" ? ar : en);
  const pick = (value: { en: string; ar: string }) => (appSettings.language === "ar" ? value.ar : value.en);

  const creditsBlocked = Boolean(user)
    && (() => {
      const remainingTokens = typeof user?.daily_tokens_remaining === "number"
        ? user.daily_tokens_remaining
        : (typeof user?.daily_tokens_limit === "number" && typeof user?.daily_tokens_used === "number"
          ? Math.max(0, user.daily_tokens_limit - user.daily_tokens_used)
          : null);
      if (remainingTokens !== null && remainingTokens > 0) return false;
      return (user?.credits ?? 0) <= 0;
    })();

  useEffect(() => {
    if (!creditsBlocked) {
      setCreditNotice(null);
      return;
    }
    setCreditNotice(
      t(
        "Token budget exhausted. Add credits to continue running simulations.",
        "ط§ظ„ط±طµظٹط¯ ط§ظ†طھظ‡ظ‰. ط§ط´ط­ظ† ط±طµظٹط¯ظƒ ظ„طھظƒظ…ظ„ط© ط§ظ„ظ…ط­ط§ظƒط§ط©."
      )
    );
  }, [creditsBlocked, t]);

  const handleLogout = async () => {
    await apiService.logout();
    navigate("/");
  };

  const handleStartSimulation = (idea?: string) => {
    if (creditsBlocked) {
      setCreditNotice(
        t(
          "Token budget exhausted. Add credits to continue.",
          "ط§ظ„ط±طµظٹط¯ ط§ظ†طھظ‡ظ‰. ط§ط´ط­ظ† ط±طµظٹط¯ظƒ ظ„ظ„ظ…طھط§ط¨ط¹ط©."
        )
      );
      return;
    }
    const text = (idea || quickIdea).trim();
    if (text) {
      localStorage.setItem("pendingIdea", text);
      localStorage.setItem("pendingAutoStart", "true");
    }
    navigate("/simulate");
  };

  const handleIdeaCourt = () => {
    const text = quickIdea.trim();
    if (!text) return;
    localStorage.setItem("pendingCourtIdea", text);
    navigate("/court");
  };

  const handleRedeem = async () => {
    if (!promo.trim()) return;
    try {
      const res = await apiService.redeemPromo(promo.trim());
      setRedeemMessage(`Added ${res.bonus_attempts} credits to your account.`);
      const me = await apiService.getMe();
      setUser(me);
      setPromo("");
    } catch (err: any) {
      setRedeemMessage(err.message || "Failed to redeem the code.");
    }
  };

  const handlePromote = async () => {
    if (!promoteSecret.trim()) return;
    setPromoteMessage(null);
    setPromoteBusy(true);
    try {
      await apiService.promoteSelf(promoteSecret.trim());
      setPromoteMessage("Role updated to admin.");
      const me = await apiService.getMe();
      setUser(me);
      setPromoteSecret("");
    } catch (err: any) {
      setPromoteMessage(err.message || "Failed to promote account.");
    } finally {
      setPromoteBusy(false);
    }
  };


  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[#0b0b12] text-white">
        {t("Loading dashboard...", "ط¬ط§ط±ظٹ طھط­ظ…ظٹظ„ ظ„ظˆط­ط© ط§ظ„طھط­ظƒظ…...")}
      </div>
    );
  }

  if (!user) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[#0b0b12] text-white">
        {t("Session not found.", "ظ„ظ… ظٹطھظ… ط§ظ„ط¹ط«ظˆط± ط¹ظ„ظ‰ ط§ظ„ط¬ظ„ط³ط©.")}
      </div>
    );
  }

  return (
    <div className="font-display h-screen bg-[#0b0b12] text-white overflow-hidden">
      <div className="flex h-full">
        <aside className="w-[280px] shrink-0 border-r border-white/10 bg-[#0e0f14] flex flex-col px-4 py-6 overflow-y-auto scrollbar-thin">
          <div className="flex items-center justify-between mb-6">
            <div className="relative">
                <button
                ref={profileButtonRef}
                type="button"
                onClick={() => setShowProfileMenu((prev) => !prev)}
                aria-label="Open profile menu"
                className="h-10 w-10 rounded-full bg-gradient-to-br from-emerald-300 via-cyan-300 to-amber-200 overflow-hidden flex items-center justify-center text-xs font-semibold text-slate-900"
                >
                {profileSettings.photo && !photoError ? (
                  <img
                  src={profileSettings.photo}
                  alt={displayName}
                  className="h-full w-full object-cover"
                  onError={() => setPhotoError(true)}
                  />
                ) : (
                  userInitial
                )}
                </button>

              {showProfileMenu && (
                <div
                  ref={menuRef}
                  className={`absolute mt-2 w-48 rounded-xl border border-white/10 bg-[#15161c] p-2 text-sm shadow-xl ${appSettings.language === "ar" ? "right-0" : "left-0"}`}
                >
                  <button
                    type="button"
                    onClick={() => {
                      setShowProfileMenu(false);
                      navigate("/settings");
                    }}
                    className="w-full rounded-lg px-3 py-2 text-left text-white/80 hover:bg-white/10"
                  >
                    {t("Settings", "ط§ظ„ط¥ط¹ط¯ط§ط¯ط§طھ")}
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setShowProfileMenu(false);
                      navigate("/bonus");
                    }}
                    className="w-full rounded-lg px-3 py-2 text-left text-white/80 hover:bg-white/10"
                  >
                    {t("Bonus (coming soon)", "ط§ظ„ظ…ظƒط§ظپط¢طھ (ظ‚ط±ظٹط¨ظ‹ط§)")}
                  </button>
                  <button
                    type="button"
                    onClick={handleLogout}
                    className="w-full rounded-lg px-3 py-2 text-left text-white/80 hover:bg-white/10"
                  >
                    {t("Log out", "طھط³ط¬ظٹظ„ ط§ظ„ط®ط±ظˆط¬")}
                  </button>
                </div>
              )}
            </div>

         
          </div>

          <div className="mt-6 space-y-2 text-sm">
            <button
              type="button"
              className="flex w-full items-center gap-2 rounded-lg bg-white/10 px-3 py-2 text-left"
            >
              {t("Home", "ط§ظ„ط±ط¦ظٹط³ظٹط©")}
            </button>
            <button
              type="button"
              onClick={() => navigate("/simulate")}
              className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-white/70 hover:bg-white/5"
            >
              {t("Simulation", "ط§ظ„ظ…ط­ط§ظƒط§ط©")}
            </button>
            <button
              type="button"
              onClick={() => navigate("/research")}
              className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-white/70 hover:bg-white/5"
            >
              {t("Research", "ط§ظ„ط£ط¨ط­ط§ط«")}
            </button>
            <button
              type="button"
              onClick={() => navigate("/court")}
              className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-white/70 hover:bg-white/5"
            >
              {t("Idea Court", "ظ…ط­ظƒظ…ط© ط§ظ„ط£ظپظƒط§ط±")}
            </button>
          </div>

          <div className="mt-8">
            <div className="text-xs uppercase tracking-[0.25em] text-white/40">{t("Ideas", "ط§ظ„ط£ظپظƒط§ط±")}</div>
            <div className="mt-3 space-y-1 text-sm text-white/70">
              {ideaList.map((idea) => (
                <button
                  key={idea.title.en}
                  type="button"
                  onClick={() => handleStartSimulation(pick(idea.prompt))}
                  className="w-full rounded-md px-2 py-1 text-left hover:bg-white/5"
                >
                  {pick(idea.title)}
                </button>
              ))}
            </div>
            <button
              type="button"
              onClick={() => navigate("/simulate")}
              className="mt-3 text-xs text-white/60 hover:text-white"
            >
              {t("All ideas", "ظƒظ„ ط§ظ„ط£ظپظƒط§ط±")}
            </button>
          </div>

          <div className="mt-auto space-y-4 pt-6">
            <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
              <div className="text-xs uppercase tracking-[0.2em] text-white/50">{t("Credits", "ط§ظ„ط±طµظٹط¯")}</div>
              <div className="mt-2 text-2xl font-semibold">{user.credits}</div>
              {typeof user.daily_tokens_used === "number" && typeof user.daily_tokens_limit === "number" ? (
                <div className="mt-1 text-xs text-white/50">
                  {t("Daily tokens", "التوكنز اليومية")}{' '}
                  <span dir="ltr">
                    {user.daily_tokens_used} / {user.daily_tokens_limit}
                  </span>
                </div>
              ) : (typeof user.daily_usage === "number" && typeof user.daily_limit === "number" && (
                <div className="mt-1 text-xs text-white/50">
                  {t("Daily usage", "ط§ظ„ط§ط³طھط®ط¯ط§ظ… ط§ظ„ظٹظˆظ…ظٹ")}{' '}
                  <span dir="ltr">
                    {user.daily_usage} / {user.daily_limit}
                  </span>
                </div>
              )}
            </div>

            <button
              type="button"
              onClick={() => navigate("/bonus")}
              className="w-full rounded-full border border-white/20 py-2 text-sm text-white/80"
            >
              {t("Buy credits", "ط´ط±ط§ط، ط±طµظٹط¯")}
            </button>
          </div>
        </aside>

        <main className="relative flex-1 overflow-hidden">
          <div className="absolute inset-0 bg-[radial-gradient(circle_at_top,_rgba(59,130,246,0.55),_transparent_55%),radial-gradient(circle_at_bottom,_rgba(236,72,153,0.65),_transparent_50%),linear-gradient(180deg,_#0b0b12_0%,_#0f111a_100%)]" />
          <div className="relative z-10 h-full overflow-y-auto px-10 py-10 scrollbar-thin">
            {creditNotice && (
              <div className="mb-6 rounded-2xl border border-amber-400/30 bg-amber-400/10 px-4 py-3 text-sm text-amber-100 flex flex-wrap items-center justify-between gap-3">
                <span>{creditNotice}</span>
                <button
                  type="button"
                  onClick={() => navigate("/bonus")}
                  className="rounded-full bg-white px-4 py-1.5 text-xs font-semibold text-slate-900"
                >
                  {t("Buy credits", "ط´ط±ط§ط، ط±طµظٹط¯")}
                </button>
              </div>
            )}
            <div className="flex items-center justify-center">
              <div className="inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/10 px-4 py-2 text-xs text-white/70">
                {t("New", "ط¬ط¯ظٹط¯")}
                <span className="text-white/90">{t("Introducing Agentic Lab Pro", "ظ†ظ‚ط¯ظ… Agentic Lab Pro")}</span>
              </div>
            </div>

            <h1 className="mt-6 text-center text-4xl font-semibold text-white md:text-5xl">
              {t(`Lets build something, ${displayName}`, `ط¨طھظپظƒط± ظپ ط§ظٹظ‡طں `)}
            </h1>

            <div className="mt-8 flex justify-center">
              <div className="w-full max-w-4xl rounded-[28px] border border-white/15 bg-black/60 p-6 shadow-2xl backdrop-blur-xl">
                <div className="text-sm text-white/60">{t("Ask Agentic to simulate a launch for", "ط§ط·ظ„ط¨ ظ…ظ† Agentic ظ…ط­ط§ظƒط§ط© ط¥ط·ظ„ط§ظ‚ ظ„ظ€")}</div>
                <div className="mt-4 flex flex-col gap-4 md:flex-row md:items-center">
                  <button
                    type="button"
                    onClick={() => {
                      if (!quickIdea.trim()) return;
                      setShowIdeaActions((prev) => !prev);
                    }}
                    disabled={!quickIdea.trim()}
                    className="flex h-12 w-12 items-center justify-center rounded-full border border-white/20 bg-white/5 text-lg text-white/80 disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    +
                  </button>
                  <input
                    value={quickIdea}
                    onChange={(event) => setQuickIdea(event.target.value)}
                    placeholder={t("Describe your idea", "طµظپ ظپظƒط±طھظƒ")}
                    className="flex-1 rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-sm text-white placeholder:text-white/40 focus:outline-none focus:ring-2 focus:ring-white/30"
                  />
                  <div className="flex items-center gap-4">
                    <span className="text-xs uppercase tracking-[0.3em] text-white/50">{t("Plan", "ط§ظ„ط®ط·ط©")}</span>
                    <button
                      type="button"
                      onClick={() => {
                        if (!quickIdea.trim()) return;
                        setShowIdeaActions((prev) => !prev);
                      }}
                      disabled={!quickIdea.trim()}
                      className="flex h-12 w-12 items-center justify-center rounded-full bg-white text-slate-900 shadow-lg shadow-white/20 disabled:cursor-not-allowed disabled:opacity-40"
                    >
                      -{'>'}
                    </button>
                  </div>
                </div>

                {showIdeaActions && quickIdea.trim() && (
                  <div className="mt-4 rounded-2xl border border-white/10 bg-white/5 p-4">
                    <div className="text-xs uppercase tracking-[0.3em] text-white/50">{t("Next steps", "ط§ظ„ط®ط·ظˆط§طھ ط§ظ„طھط§ظ„ظٹط©")}</div>
                    <div className="mt-3 space-y-2">
                      <button
                        type="button"
                        onClick={() => handleStartSimulation()}
                        className="flex w-full items-center justify-between rounded-xl border border-white/10 bg-black/40 px-4 py-3 text-sm text-white/90 hover:border-white/30"
                      >
                        <span>{t("1 - Simulate your idea", "1 - ط­ط§ظƒظٹ ظپظƒط±طھظƒ")}</span>
                        <span className="text-xs text-white/40">{t("Start", "ط§ط¨ط¯ط£")}</span>
                      </button>
                      <button
                        type="button"
                        onClick={handleIdeaCourt}
                        className="flex w-full items-center justify-between rounded-xl border border-white/10 bg-black/40 px-4 py-3 text-sm text-white/90 hover:border-white/30"
                      >
                        <span>{t("2 - Take it to court", "2 - ط§ط¹ط±ط¶ظ‡ط§ ط¹ظ„ظ‰ ظ…ط­ظƒظ…ط© ط§ظ„ط£ظپظƒط§ط±")}</span>
                        <span className="text-xs text-white/40">{t("Debate", "ظ†ظ‚ط§ط´")}</span>
                      </button>
                      <button
                        type="button"
                        disabled
                        className="flex w-full items-center justify-between rounded-xl border border-white/10 bg-black/30 px-4 py-3 text-sm text-white/60 opacity-60"
                      >
                        <span>{t("3 - Simulate your project live (virtual)", "3 - ط­ط§ظƒظٹ ظ…ط´ط±ظˆط¹ظƒ ظ…ط¨ط§ط´ط±ط© (ط§ظپطھط±ط§ط¶ظٹ)")}</span>
                        <span className="text-xs text-white/40">{t("Coming soon", "ظ‚ط±ظٹط¨ظ‹ط§")}</span>
                      </button>
                    </div>
                  </div>
                )}
              </div>
            </div>

            <div className="mt-10 rounded-3xl border border-white/10 bg-black/70 p-6 shadow-2xl backdrop-blur-xl">
              <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
                <div className="flex flex-wrap gap-2 text-sm text-white/70">
                  <button
                    type="button"
                    className="rounded-full border border-white/15 bg-white/10 px-4 py-2 text-white"
                  >
                    {t("Recently viewed", "ط´ظˆظ‡ط¯ ظ…ط¤ط®ط±ظ‹ط§")}
                  </button>
                  <button type="button" className="rounded-full px-4 py-2 hover:bg-white/5">
                    {t("My ideas", "ط£ظپظƒط§ط±ظٹ")}
                  </button>
           
                </div>
                <button
                  type="button"
                  onClick={() => navigate("/simulate")}
                  className="text-sm text-white/70 hover:text-white"
                >
                  {t("Browse all", "طھطµظپط­ ط§ظ„ظƒظ„")} -{'>'}
                </button>
              </div>
              <div className="mt-6 grid gap-4 md:grid-cols-3">
                {ideaList.map((idea) => (
                  <button
                    key={idea.title.en}
                    type="button"
                    onClick={() => handleStartSimulation(pick(idea.prompt))}
                    className="rounded-2xl border border-white/10 bg-white/5 p-4 text-left hover:border-white/20"
                  >
                    <div className="text-xs uppercase tracking-[0.3em] text-white/50">{pick(idea.tag)}</div>
                    <div className="mt-2 text-sm font-semibold text-white">{pick(idea.title)}</div>
                    <div className="mt-1 text-xs text-white/60">{pick(idea.description)}</div>
                  </button>
                ))}
              </div>
            </div>

            <div className="mt-10 grid gap-6 lg:grid-cols-[2fr_1fr]">
              <div className="rounded-3xl border border-white/10 bg-white/5 p-6">
                <div className="text-xs uppercase tracking-[0.3em] text-white/50">{t("Idea templates", "ظ‚ظˆط§ظ„ط¨ ط§ظ„ط£ظپظƒط§ط±")}</div>
                <div className="mt-4 grid gap-4 md:grid-cols-3">
                  {templates.map((template) => (
                    <button
                      key={template.title.en}
                      type="button"
                      onClick={() => navigate("/simulate")}
                      className="rounded-2xl border border-white/10 bg-white/5 p-4 text-left hover:border-white/20"
                    >
                      <div className="text-sm font-semibold">{pick(template.title)}</div>
                      <div className="mt-2 text-xs text-white/60">{pick(template.description)}</div>
                    </button>
                  ))}
                </div>
              </div>

              <div className="space-y-6">
                <div className="rounded-3xl border border-white/10 bg-white/5 p-6">
                  <div className="text-xs uppercase tracking-[0.3em] text-white/50">{t("Redeem code", "ط§ط³طھط¨ط¯ط§ظ„ ظƒظˆط¯")}</div>
                  <Input
                    value={promo}
                    placeholder={t("Enter promo code", "ط£ط¯ط®ظ„ ظƒظˆط¯ ط§ظ„طھط±ظˆظٹط¬")}
                    onChange={(event) => setPromo(event.target.value)}
                    className="mt-3 bg-white/5 border-white/10 text-white placeholder:text-white/40 focus-visible:ring-emerald-300"
                  />
                  <button
                    type="button"
                    onClick={handleRedeem}
                    className="mt-3 w-full rounded-full bg-white px-4 py-2 text-sm font-semibold text-slate-900"
                  >
                    {t("Redeem", "ط§ط³طھط¨ط¯ط§ظ„")}
                  </button>
                  {redeemMessage && <p className="mt-2 text-xs text-white/60">{redeemMessage}</p>}
                </div>

                {user.role === "admin" ? (
                  <button
                    type="button"
                    onClick={() => navigate("/control-center")}
                    className="w-full rounded-full border border-white/20 py-3 text-sm text-white/80"
                  >
                    {t("Open admin dashboard", "ظپطھط­ ظ„ظˆط­ط© ط§ظ„ط¥ط¯ط§ط±ط©")}
                  </button>
                ) : (
                  <div className="rounded-3xl border border-white/10 bg-white/5 p-6">
                    <div className="text-xs uppercase tracking-[0.3em] text-white/50">{t("Admin access", "ظˆطµظˆظ„ ط§ظ„ط¥ط¯ط§ط±ط©")}</div>
                    <Input
                      value={promoteSecret}
                      placeholder={t("Promotion secret", "ط³ط± ط§ظ„طھط±ظ‚ظٹط©")}
                      onChange={(event) => setPromoteSecret(event.target.value)}
                      className="mt-3 bg-white/5 border-white/10 text-white placeholder:text-white/40 focus-visible:ring-emerald-300"
                    />
                    <button
                      type="button"
                      onClick={handlePromote}
                      disabled={promoteBusy}
                      className="mt-3 w-full rounded-full border border-white/20 py-2 text-sm text-white/80 disabled:opacity-60"
                    >
                      {promoteBusy ? t("Please wait...", "ظٹط±ط¬ظ‰ ط§ظ„ط§ظ†طھط¸ط§ط±...") : t("Promote", "طھط±ظ‚ظٹط©")}
                    </button>
                    {promoteMessage && <p className="mt-2 text-xs text-white/60">{promoteMessage}</p>}
                  </div>
                )}
              </div>
            </div>
          </div>
        </main>
      </div>

    </div>
  );
};

export default LandingPage;

