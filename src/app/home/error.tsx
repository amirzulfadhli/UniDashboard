"use client";

import Link from "next/link";

export default function DashboardError() {
  return <main className="mx-auto max-w-xl px-6 py-24">
    <p className="text-sm font-medium text-emerald-800">UniOS · Overview</p>
    <h1 className="mt-3 text-3xl font-semibold">Your overview couldn’t load.</h1>
    <p className="mt-4 text-slate-600">Try again in a moment. Your saved classes and work are still in your workspace.</p>
    <div className="mt-6 flex gap-5"><a className="rounded-lg bg-emerald-900 px-4 py-2 text-white focus-visible:outline-2 focus-visible:outline-offset-4" href="/home">Try again</a><Link className="self-center text-emerald-800 underline" href="/work">Open work</Link></div>
  </main>;
}
