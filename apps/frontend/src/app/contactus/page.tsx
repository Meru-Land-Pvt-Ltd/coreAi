"use client";

import Link from "next/link";
import { useEffect, useState, type FormEvent } from "react";
import { CoreHeader } from "@/components/common/header";
import { CoreFooter } from "@/components/common/footer";

type ContactFormState = {
  name: string;
  email: string;
  subject: string;
  message: string;
};

type ContactErrors = Partial<Record<keyof ContactFormState, string>>;

const initialForm: ContactFormState = {
  name: "",
  email: "",
  subject: "",
  message: ""
};

const subjectOptions = [
  { value: "general", label: "General Inquiry" },
  { value: "business-support", label: "Business Support" },
  { value: "architect-support", label: "AI Architect Support" },
  { value: "partnership", label: "Partnership" },
  { value: "bug-report", label: "Bug Report" }
];

const quickLinks = [
  {
    label: "How do I install an agent?",
    href: "/help"
  },
  {
    label: "How do I become an AI Architect?",
    href: "/help"
  },
  {
    label: "What's your refund policy?",
    href: "/help"
  },
  {
    label: "How does billing work?",
    href: "/help"
  }
];

export default function ContactPage() {
  const [menuOpen, setMenuOpen] = useState(false);
  const [navScrolled, setNavScrolled] = useState(true);
  const [form, setForm] = useState<ContactFormState>(initialForm);
  const [errors, setErrors] = useState<ContactErrors>({});
  const [submitted, setSubmitted] = useState(false);

  useEffect(() => {
    const onScroll = () => setNavScrolled(window.scrollY > 8);

    window.addEventListener("scroll", onScroll, { passive: true });
    onScroll();

    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  function updateField(field: keyof ContactFormState, value: string) {
    setForm((current) => ({
      ...current,
      [field]: value
    }));

    setErrors((current) => {
      const next = { ...current };
      delete next[field];
      return next;
    });
  }

  function validateForm() {
    const nextErrors: ContactErrors = {};

    if (!form.name.trim()) {
      nextErrors.name = "Please enter your full name.";
    }

    if (!form.email.trim() || !isValidEmail(form.email.trim())) {
      nextErrors.email = "Please enter a valid email address.";
    }

    if (!form.subject) {
      nextErrors.subject = "Please select a subject.";
    }

    if (!form.message.trim()) {
      nextErrors.message = "Please enter a message.";
    }

    setErrors(nextErrors);
    return Object.keys(nextErrors).length === 0;
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!validateForm()) return;

    setSubmitted(true);
  }

  return (
    <div className="min-h-screen bg-gray-50 text-slate-900 antialiased selection:bg-amber-200 selection:text-amber-900">
      <CoreHeader
        navTop={0}
        navScrolled={navScrolled}
        menuOpen={menuOpen}
        onToggleMenu={() => setMenuOpen((open) => !open)}
        onCloseMenu={() => setMenuOpen(false)}
      />

      <main>
        <section className="px-6 pb-16 pt-36 text-center md:pb-20 md:pt-40">
          <div className="mx-auto max-w-3xl">
            <h1 className="text-4xl font-extrabold tracking-tight text-slate-900 md:text-5xl">
              Get in Touch
            </h1>

            <p className="mt-5 text-lg leading-relaxed text-slate-600">
              Have a question, need support, or want to partner with us? We typically
              respond within 2 hours.
            </p>
          </div>
        </section>

        <section className="px-6">
          <div className="mx-auto max-w-lg rounded-2xl border border-gray-100 bg-white p-8 shadow-lg">
            {!submitted ? (
              <form noValidate onSubmit={handleSubmit}>
                <div>
                  <label htmlFor="name" className="mb-1.5 block text-sm font-medium text-slate-700">
                    Full Name
                  </label>

                  <input
                    id="name"
                    name="name"
                    type="text"
                    required
                    value={form.name}
                    onChange={(event) => updateField("name", event.target.value)}
                    placeholder="Jane Smith"
                    className={inputClass(Boolean(errors.name))}
                  />

                  {errors.name ? <ErrorMessage>{errors.name}</ErrorMessage> : null}
                </div>

                <div className="mt-5">
                  <label htmlFor="email" className="mb-1.5 block text-sm font-medium text-slate-700">
                    Email Address
                  </label>

                  <input
                    id="email"
                    name="email"
                    type="email"
                    required
                    value={form.email}
                    onChange={(event) => updateField("email", event.target.value)}
                    placeholder="you@company.com"
                    className={inputClass(Boolean(errors.email))}
                  />

                  {errors.email ? <ErrorMessage>{errors.email}</ErrorMessage> : null}
                </div>

                <div className="mt-5">
                  <label htmlFor="subject" className="mb-1.5 block text-sm font-medium text-slate-700">
                    Subject
                  </label>

                  <select
                    id="subject"
                    name="subject"
                    required
                    value={form.subject}
                    onChange={(event) => updateField("subject", event.target.value)}
                    className={inputClass(Boolean(errors.subject))}
                  >
                    <option value="" disabled>
                      Select a topic
                    </option>

                    {subjectOptions.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>

                  {errors.subject ? <ErrorMessage>{errors.subject}</ErrorMessage> : null}
                </div>

                <div className="mt-5">
                  <label htmlFor="message" className="mb-1.5 block text-sm font-medium text-slate-700">
                    Message
                  </label>

                  <textarea
                    id="message"
                    name="message"
                    rows={5}
                    required
                    value={form.message}
                    onChange={(event) => updateField("message", event.target.value)}
                    placeholder="Tell us how we can help..."
                    className={`${inputClass(Boolean(errors.message))} resize-none`}
                  />

                  {errors.message ? <ErrorMessage>{errors.message}</ErrorMessage> : null}
                </div>

                <button
                  type="submit"
                  data-testid="contact-submit"
                  className="mt-6 w-full rounded-xl bg-amber-500 py-3 font-semibold text-white transition-all duration-200 hover:-translate-y-0.5 hover:bg-amber-600 hover:shadow-[0_8px_20px_-6px_rgba(245,158,11,0.5)] active:scale-[0.99]"
                >
                  Send Message
                </button>
              </form>
            ) : (
              <div className="py-6 text-center">
                <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-green-100">
                  <svg
                    className="h-9 w-9 text-green-600"
                    fill="none"
                    viewBox="0 0 24 24"
                    stroke="currentColor"
                    strokeWidth="3"
                    aria-hidden="true"
                  >
                    <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                  </svg>
                </div>

                <h2 className="mt-5 text-xl font-extrabold text-slate-900">
                  Message sent!
                </h2>

                <p className="mt-2 text-sm text-slate-500">
                  We&apos;ll get back to you within 2 hours.
                </p>

                <button
                  type="button"
                  data-testid="contact-send-another"
                  onClick={() => {
                    setSubmitted(false);
                    setForm(initialForm);
                    setErrors({});
                  }}
                  className="mt-6 rounded-xl border border-amber-500 px-5 py-2.5 text-sm font-semibold text-amber-600 transition hover:bg-amber-50"
                >
                  Send another message
                </button>
              </div>
            )}
          </div>
        </section>

        <section className="py-16">
          <div className="mx-auto max-w-4xl px-6">
            <div className="grid grid-cols-1 gap-8 text-center sm:grid-cols-3">
              <ContactInfo label="Email" value="hello@trycore.ai" />
              <ContactInfo label="Response Time" value="Within 2 hours" />
              <ContactInfo label="Office Hours" value="Mon–Fri, 9AM–6PM EST" />
            </div>
          </div>
        </section>

        <section className="border-y border-gray-100 bg-white py-16">
          <div className="mx-auto max-w-3xl px-6 text-center">
            <h2 className="text-2xl font-extrabold text-slate-900">
              Looking for answers?
            </h2>

            <div className="mt-8 grid gap-4 text-left sm:grid-cols-2">
              {quickLinks.map((link) => (
                <Link
                  key={link.label}
                  href={link.href as any}
                  className="block rounded-xl border border-gray-100 px-5 py-4 text-slate-700 transition-colors duration-200 hover:border-amber-200 hover:text-amber-600"
                >
                  {link.label}
                </Link>
              ))}
            </div>
          </div>
        </section>

        <section className="bg-white py-12 text-center">
          <div className="mx-auto max-w-4xl px-6">
            <h2 className="text-xl font-bold text-slate-900">Ready to get started?</h2>

            <Link
              href="/marketplace"
              className="mt-4 inline-flex items-center justify-center rounded-xl bg-amber-500 px-8 py-3.5 font-semibold text-white shadow-lg shadow-amber-500/30 transition-all hover:-translate-y-0.5 hover:bg-amber-600 hover:shadow-amber-500/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-400 focus-visible:ring-offset-2"
            >
              Browse AI Agents
            </Link>
          </div>
        </section>
      </main>

      <CoreFooter />
    </div>
  );
}

function inputClass(hasError: boolean) {
  return [
    "w-full rounded-xl border bg-white px-4 py-3 text-slate-900 placeholder:text-slate-400 transition focus:outline-none focus:ring-4",
    hasError
      ? "border-red-300 focus:border-red-400 focus:ring-red-100"
      : "border-gray-200 focus:border-amber-400 focus:ring-amber-100"
  ].join(" ");
}

function isValidEmail(value: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

function ErrorMessage({ children }: { children: string }) {
  return <p className="mt-1.5 text-sm text-red-500">{children}</p>;
}

function ContactInfo({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-xs font-semibold uppercase tracking-wide text-amber-600">
        {label}
      </p>
      <p className="mt-2 font-medium text-slate-900">{value}</p>
    </div>
  );
}