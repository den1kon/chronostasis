export function App() {
  return (
    <main className="mx-auto w-full max-w-160 p-[clamp(1.25rem,5vw,3rem)] wrap-anywhere">
      <p className="my-4 font-[650] tracking-[0.08em] text-leaf">Chronostasis</p>
      <h1 className="my-[0.67em] text-[clamp(2.25rem,9vw,4rem)] leading-[1.2] font-bold text-balance">
        Make room for focus.
      </h1>
      <p className="my-4">Finish a focus session. Open a chest. Collect a little wonder.</p>
      <section className="mt-10 rounded-2xl border border-outline p-5" aria-labelledby="bootstrap-heading">
        <h2 id="bootstrap-heading" className="my-[0.83em] text-[1.3rem] leading-[1.2] font-bold text-balance">
          The journey starts here
        </h2>
        <p className="my-4">The application foundation is taking shape. Focus sessions and your collection are coming later.</p>
      </section>
    </main>
  );
}
