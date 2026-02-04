import { useNavigate } from "react-router-dom";

const BonusPage = () => {
  const navigate = useNavigate();
  return (
    <div className="min-h-screen bg-[#0b0b12] text-white flex items-center justify-center px-6">
      <div className="max-w-lg w-full rounded-3xl border border-white/10 bg-white/5 p-8 text-center">
        <h1 className="text-2xl font-semibold">Bonus Credits</h1>
        <p className="mt-3 text-sm text-white/60">
          Coming soon. We are preparing bonus packs for teams and founders.
        </p>
        <button
          type="button"
          onClick={() => navigate("/dashboard")}
          className="mt-6 rounded-full bg-white px-6 py-2 text-sm font-semibold text-slate-900"
        >
          Back to dashboard
        </button>
      </div>
    </div>
  );
};

export default BonusPage;
