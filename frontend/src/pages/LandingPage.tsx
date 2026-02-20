import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { apiService, UserMe } from "@/services/api";
import { Input } from "@/components/ui/input";

const ideaList = [
  {
    title: { en: "Agent Insights Hub", ar: "مركز رؤى الوكلاء" },
    tag: { en: "Simulation", ar: "المحاكاة" },
    description: {
      en: "Multi-agent feedback for a SaaS launch in MENA markets.",
      ar: "آراء متعددة من الوكلاء لإطلاق SaaS في أسواق الشرق الأوسط وشمال أفريقيا.",
    },
    prompt: {
      en: "Agent insights hub for SaaS launches in MENA markets",
      ar: "مركز رؤى الوكلاء لإطلاقات SaaS في أسواق الشرق الأوسط وشمال أفريقيا",
    },
  },
  {
    title: { en: "Retail Demand Pulse", ar: "نبض الطلب في التجزئة" },
    tag: { en: "Research", ar: "الأبحاث" },
    description: {
      en: "Market signals for retail pricing automation.",
      ar: "إشارات السوق لأتمتة تسعير التجزئة.",
    },
    prompt: {
      en: "Retail demand pulse for pricing automation",
      ar: "نبض الطلب في التجزئة لأتمتة التسعير",
    },
  },
  {
    title: { en: "Idea Court Draft", ar: "مسودة محكمة الأفكار" },
    tag: { en: "Debate", ar: "مناظرة" },
    description: {
      en: "Run pro/con arguments on a new fintech feature.",
      ar: "شغّل حججًا مؤيدة ومعارضة لميزة فينتك جديدة.",
    },
    prompt: {
      en: "Debate a new fintech feature for subscription pricing",
      ar: "مناظرة حول ميزة فينتك جديدة لتسعير الاشتراكات",
    },
  },
];

const templates = [
  {
    title: { en: "Launch Readiness", ar: "جاهزية الإطلاق" },
    description: {
      en: "Validate a new product idea with agent feedback.",
      ar: "تحقق من فكرة منتج جديد عبر ملاحظات الوكلاء.",
    },
  },
  {
    title: { en: "Market Research", ar: "أبحاث السوق" },
    description: {
      en: "Summarize demand, competition, and gaps.",
      ar: "تلخيص الطلب والمنافسة والفجوات.",
    },
  },
  {
    title: { en: "Idea Court", ar: "محكمة الأفكار" },
    description: {
      en: "Run a debate between advocates and skeptics.",
      ar: "مناظرة بين المؤيدين والمتشككين.",
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
        "انتهى رصيد التوكنز. اشحن رصيدك لمواصلة المحاكاة."
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
          "انتهى رصيد التوكنز. اشحن رصيدك للمتابعة."
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
        {t("Loading dashboard...", "جارٍ تحميل لوحة التحكم...")}
      </div>
    );
  }

  if (!user) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[#0b0b12] text-white">
        {t("Session not found.", "لم يتم العثور على الجلسة.")}
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
                    {t("Settings", "الإعدادات")}
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setShowProfileMenu(false);
                      navigate("/bonus");
                    }}
                    className="w-full rounded-lg px-3 py-2 text-left text-white/80 hover:bg-white/10"
                  >
                    {t("Bonus (coming soon)", "المكافآت (قريبًا)")}
                  </button>
                  <button
                    type="button"
                    onClick={handleLogout}
                    className="w-full rounded-lg px-3 py-2 text-left text-white/80 hover:bg-white/10"
                  >
                    {t("Log out", "تسجيل الخروج")}
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
              {t("Home", "الرئيسية")}
            </button>
            <button
              type="button"
              onClick={() => navigate("/simulate")}
              className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-white/70 hover:bg-white/5"
            >
              {t("Simulation", "المحاكاة")}
            </button>
            <button
              type="button"
              onClick={() => navigate("/research")}
              className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-white/70 hover:bg-white/5"
            >
              {t("Research", "الأبحاث")}
            </button>
            <button
              type="button"
              onClick={() => navigate("/court")}
              className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-white/70 hover:bg-white/5"
            >
              {t("Idea Court", "محكمة الأفكار")}
            </button>
          </div>

          <div className="mt-8">
            <div className="text-xs uppercase tracking-[0.25em] text-white/40">{t("Ideas", "الأفكار")}</div>
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
              {t("All ideas", "كل الأفكار")}
            </button>
          </div>

          <div className="mt-auto space-y-4 pt-6">
            <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
              <div className="text-xs uppercase tracking-[0.2em] text-white/50">{t("Credits", "الرصيد")}</div>
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
                  {t("Daily usage", "الاستخدام اليومي")}{' '}
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
              {t("Buy credits", "شراء رصيد")}
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
                  {t("Buy credits", "شراء رصيد")}
                </button>
              </div>
            )}
            <div className="flex items-center justify-center">
              <div className="inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/10 px-4 py-2 text-xs text-white/70">
                {t("New", "جديد")}
                <span className="text-white/90">{t("Introducing Agentic Lab Pro", "نقدّم Agentic Lab Pro")}</span>
              </div>
            </div>

            <h1 className="mt-6 text-center text-4xl font-semibold text-white md:text-5xl">
              {t(`Lets build something, ${displayName}`, `خلّينا نبني شيئًا مميزًا، ${displayName}`)}
            </h1>

            <div className="mt-8 flex justify-center">
              <div className="w-full max-w-4xl rounded-[28px] border border-white/15 bg-black/60 p-6 shadow-2xl backdrop-blur-xl">
                <div className="text-sm text-white/60">{t("Ask Agentic to simulate a launch for", "اطلب من Agentic محاكاة إطلاق لـ")}</div>
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
                    placeholder={t("Describe your idea", "صِف فكرتك")}
                    className="flex-1 rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-sm text-white placeholder:text-white/40 focus:outline-none focus:ring-2 focus:ring-white/30"
                  />
                  <div className="flex items-center gap-4">
                    <span className="text-xs uppercase tracking-[0.3em] text-white/50">{t("Plan", "الخطة")}</span>
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
                    <div className="text-xs uppercase tracking-[0.3em] text-white/50">{t("Next steps", "الخطوات التالية")}</div>
                    <div className="mt-3 space-y-2">
                      <button
                        type="button"
                        onClick={() => handleStartSimulation()}
                        className="flex w-full items-center justify-between rounded-xl border border-white/10 bg-black/40 px-4 py-3 text-sm text-white/90 hover:border-white/30"
                      >
                        <span>{t("1 - Simulate your idea", "1 - حاكِ فكرتك")}</span>
                        <span className="text-xs text-white/40">{t("Start", "ابدأ")}</span>
                      </button>
                      <button
                        type="button"
                        onClick={handleIdeaCourt}
                        className="flex w-full items-center justify-between rounded-xl border border-white/10 bg-black/40 px-4 py-3 text-sm text-white/90 hover:border-white/30"
                      >
                        <span>{t("2 - Take it to court", "2 - اعرضها على محكمة الأفكار")}</span>
                        <span className="text-xs text-white/40">{t("Debate", "نقاش")}</span>
                      </button>
                      <button
                        type="button"
                        disabled
                        className="flex w-full items-center justify-between rounded-xl border border-white/10 bg-black/30 px-4 py-3 text-sm text-white/60 opacity-60"
                      >
                        <span>{t("3 - Simulate your project live (virtual)", "3 - حاكِ مشروعك مباشرة (افتراضي)")}</span>
                        <span className="text-xs text-white/40">{t("Coming soon", "قريبًا")}</span>
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
                    {t("Recently viewed", "شوهد مؤخرًا")}
                  </button>
                  <button type="button" className="rounded-full px-4 py-2 hover:bg-white/5">
                    {t("My ideas", "أفكاري")}
                  </button>
           
                </div>
                <button
                  type="button"
                  onClick={() => navigate("/simulate")}
                  className="text-sm text-white/70 hover:text-white"
                >
                  {t("Browse all", "تصفّح الكل")} -{'>'}
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
                <div className="text-xs uppercase tracking-[0.3em] text-white/50">{t("Idea templates", "قوالب الأفكار")}</div>
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
                  <div className="text-xs uppercase tracking-[0.3em] text-white/50">{t("Redeem code", "استبدال كود")}</div>
                  <Input
                    value={promo}
                    placeholder={t("Enter promo code", "أدخل كود الترويج")}
                    onChange={(event) => setPromo(event.target.value)}
                    className="mt-3 bg-white/5 border-white/10 text-white placeholder:text-white/40 focus-visible:ring-emerald-300"
                  />
                  <button
                    type="button"
                    onClick={handleRedeem}
                    className="mt-3 w-full rounded-full bg-white px-4 py-2 text-sm font-semibold text-slate-900"
                  >
                    {t("Redeem", "استبدال")}
                  </button>
                  {redeemMessage && <p className="mt-2 text-xs text-white/60">{redeemMessage}</p>}
                </div>

                {user.role === "admin" ? (
                  <button
                    type="button"
                    onClick={() => navigate("/control-center")}
                    className="w-full rounded-full border border-white/20 py-3 text-sm text-white/80"
                  >
                    {t("Open admin dashboard", "فتح لوحة الإدارة")}
                  </button>
                ) : (
                  <div className="rounded-3xl border border-white/10 bg-white/5 p-6">
                    <div className="text-xs uppercase tracking-[0.3em] text-white/50">{t("Admin access", "وصول الإدارة")}</div>
                    <Input
                      value={promoteSecret}
                      placeholder={t("Promotion secret", "سر الترقية")}
                      onChange={(event) => setPromoteSecret(event.target.value)}
                      className="mt-3 bg-white/5 border-white/10 text-white placeholder:text-white/40 focus-visible:ring-emerald-300"
                    />
                    <button
                      type="button"
                      onClick={handlePromote}
                      disabled={promoteBusy}
                      className="mt-3 w-full rounded-full border border-white/20 py-2 text-sm text-white/80 disabled:opacity-60"
                    >
                      {promoteBusy ? t("Please wait...", "يرجى الانتظار...") : t("Promote", "ترقية")}
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

