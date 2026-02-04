import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Input } from "@/components/ui/input";

const SettingsPage = () => {
  const navigate = useNavigate();
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

  const t = (en: string, ar: string) => (appSettings.language === "ar" ? ar : en);

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

  const handleSaveProfile = () => {
    try {
      window.localStorage.setItem("profileSettings", JSON.stringify(profileSettings));
    } catch {
      // ignore
    }
  };

  return (
    <div className="min-h-screen bg-[#0b0b12] text-white">
      <div className="mx-auto w-full max-w-3xl px-6 py-8">
        <div className="flex items-center justify-between">
          <h1 className="text-2xl font-semibold">{t("Settings", "الإعدادات")}</h1>
          <button
            type="button"
            onClick={() => navigate(-1)}
            className="rounded-full border border-white/10 px-4 py-2 text-sm text-white/70"
          >
            {t("Back", "رجوع")}
          </button>
        </div>

        <div className="mt-8 space-y-8">
          <div>
            <div className="text-xs uppercase tracking-[0.25em] text-white/50">{t("Profile", "الملف الشخصي")}</div>
            <div className="mt-4 space-y-3">
              <Input
                value={profileSettings.name}
                placeholder={t("Name", "الاسم")}
                onChange={(event) => setProfileSettings((prev) => ({ ...prev, name: event.target.value }))}
                className="bg-white/5 border-white/10 text-white placeholder:text-white/40 focus-visible:ring-emerald-300"
              />
              <Input
                value={profileSettings.email}
                placeholder={t("Email", "البريد الإلكتروني")}
                onChange={(event) => setProfileSettings((prev) => ({ ...prev, email: event.target.value }))}
                className="bg-white/5 border-white/10 text-white placeholder:text-white/40 focus-visible:ring-emerald-300"
              />
              <Input
                value={profileSettings.photo}
                placeholder={t("Photo URL", "رابط الصورة")}
                onChange={(event) => setProfileSettings((prev) => ({ ...prev, photo: event.target.value }))}
                className="bg-white/5 border-white/10 text-white placeholder:text-white/40 focus-visible:ring-emerald-300"
              />
            </div>
          </div>

          <div className="grid gap-6 md:grid-cols-2">
            <div>
              <div className="text-xs uppercase tracking-[0.25em] text-white/50">{t("Language", "اللغة")}</div>
              <div className="mt-3 flex gap-2">
                <button
                  type="button"
                  onClick={() => setAppSettings((prev) => ({ ...prev, language: "en" }))}
                  className={`rounded-full px-4 py-2 text-sm ${appSettings.language === "en" ? "bg-white text-slate-900" : "border border-white/20 text-white/70"}`}
                >
                  English
                </button>
                <button
                  type="button"
                  onClick={() => setAppSettings((prev) => ({ ...prev, language: "ar" }))}
                  className={`rounded-full px-4 py-2 text-sm ${appSettings.language === "ar" ? "bg-white text-slate-900" : "border border-white/20 text-white/70"}`}
                >
                  العربية
                </button>
              </div>
            </div>

            <div>
              <div className="text-xs uppercase tracking-[0.25em] text-white/50">{t("Theme", "المظهر")}</div>
              <div className="mt-3 flex gap-2">
                <button
                  type="button"
                  onClick={() => setAppSettings((prev) => ({ ...prev, theme: "dark" }))}
                  className={`rounded-full px-4 py-2 text-sm ${appSettings.theme === "dark" ? "bg-white text-slate-900" : "border border-white/20 text-white/70"}`}
                >
                  {t("Dark", "داكن")}
                </button>
                <button
                  type="button"
                  onClick={() => setAppSettings((prev) => ({ ...prev, theme: "light" }))}
                  className={`rounded-full px-4 py-2 text-sm ${appSettings.theme === "light" ? "bg-white text-slate-900" : "border border-white/20 text-white/70"}`}
                >
                  {t("Light", "فاتح")}
                </button>
              </div>
            </div>
          </div>

          <div className="flex items-center justify-end gap-3">
            <button
              type="button"
              onClick={() => navigate(-1)}
              className="rounded-full border border-white/20 px-4 py-2 text-sm text-white/70"
            >
              {t("Cancel", "إلغاء")}
            </button>
            <button
              type="button"
              onClick={handleSaveProfile}
              className="rounded-full bg-white px-4 py-2 text-sm font-semibold text-slate-900"
            >
              {t("Save", "حفظ")}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default SettingsPage;
