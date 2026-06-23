import Link from "next/link";

const agents = [
  {
    name: "Customer Support Agent",
    category: "Support",
    description: "Reads customer requests, drafts replies, and routes risky actions for approval.",
    price: "Free Prototype",
    connectors: ["Gmail", "Google Sheets", "LLM"]
  },
  {
    name: "Lead Qualification Agent",
    category: "Sales",
    description: "Scores leads, summarizes intent, and prepares next-step follow-up actions.",
    price: "₹999/month",
    connectors: ["Webhook", "CRM", "LLM"]
  },
  {
    name: "Invoice Reminder Agent",
    category: "Finance",
    description: "Checks unpaid invoices and generates polite reminder messages for approval.",
    price: "₹1499/month",
    connectors: ["Sheets", "Email", "LLM"]
  }
];

export default function MarketplacePage() {
  return (
    <main className="min-h-screen bg-[#fff8ef] p-6 text-orange-950">
      <div className="mx-auto max-w-7xl">
        <div className="mb-6 flex items-center justify-between">
          <div>
            <p className="text-sm uppercase tracking-[0.2em] text-orange-700">Marketplace</p>
            <h1 className="text-3xl font-bold">AI Agent Marketplace</h1>
          </div>

          <Link href="/" className="rounded-full border border-orange-300 px-4 py-2 text-sm">
            Home
          </Link>
        </div>

        <div className="grid gap-5 md:grid-cols-3">
          {agents.map((agent) => (
            <article key={agent.name} className="rounded-3xl soft-card p-5">
              <p className="text-xs uppercase tracking-[0.2em] text-orange-600">
                {agent.category}
              </p>

              <h2 className="mt-3 text-xl font-bold">{agent.name}</h2>
              <p className="mt-2 text-sm text-orange-800/75">{agent.description}</p>

              <div className="mt-4 flex flex-wrap gap-2">
                {agent.connectors.map((connector) => (
                  <span
                    key={connector}
                    className="rounded-full bg-orange-100 px-3 py-1 text-xs text-orange-800"
                  >
                    {connector}
                  </span>
                ))}
              </div>

              <div className="mt-5 flex items-center justify-between">
                <p className="font-semibold">{agent.price}</p>
                <button className="rounded-full bg-orange-500 px-4 py-2 text-sm font-semibold text-white">
                  Install
                </button>
              </div>
            </article>
          ))}
        </div>
      </div>
    </main>
  );
}