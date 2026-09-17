import { Calculator } from "@/components/calculator"

export default function Page() {
  return (
    <main className="page">
      <div className="page-inner">
        <header className="page-header">
          <h1 className="page-title">Event Stamina Calculator</h1>
          <p className="page-sub">
            Work out the gems and runs needed to hit your target score before each event ends.
          </p>
        </header>
        <Calculator />
      </div>
    </main>
  )
}
