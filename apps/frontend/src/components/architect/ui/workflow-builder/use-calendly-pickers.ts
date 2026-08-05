"use client";

import { useEffect, useState } from "react";
import {
  listCalendlyAvailableTimes,
  listCalendlyContacts,
  listCalendlyEventTypes,
  listCalendlyEvents,
  listCalendlyInvitees,
  listCalendlyMeetingRecaps
} from "@/components/architect/features/api";
import type { CalendlyPickerOption } from "@/components/architect/features/types";

type PickerState = {
  options: CalendlyPickerOption[];
  loading: boolean;
  error: string | null;
};

const EMPTY: PickerState = { options: [], loading: false, error: null };

export function useCalendlyEventTypeOptions(enabled: boolean): PickerState {
  const [state, setState] = useState<PickerState>(EMPTY);

  useEffect(() => {
    if (!enabled) {
      setState(EMPTY);
      return;
    }
    let cancelled = false;
    setState({ options: [], loading: true, error: null });
    void listCalendlyEventTypes().then((result) => {
      if (cancelled) return;
      if (!result.success) {
        setState({ options: [], loading: false, error: result.error ?? "Failed to load event types" });
        return;
      }
      setState({ options: result.data?.options ?? [], loading: false, error: null });
    });
    return () => {
      cancelled = true;
    };
  }, [enabled]);

  return state;
}

export function useCalendlyEventOptions(enabled: boolean, options?: { startedOnly?: boolean }): PickerState {
  const [state, setState] = useState<PickerState>(EMPTY);
  const startedOnly = Boolean(options?.startedOnly);

  useEffect(() => {
    if (!enabled) {
      setState(EMPTY);
      return;
    }
    let cancelled = false;
    setState({ options: [], loading: true, error: null });
    void listCalendlyEvents({ startedOnly }).then((result) => {
      if (cancelled) return;
      if (!result.success) {
        setState({ options: [], loading: false, error: result.error ?? "Failed to load events" });
        return;
      }
      setState({ options: result.data?.options ?? [], loading: false, error: null });
    });
    return () => {
      cancelled = true;
    };
  }, [enabled, startedOnly]);

  return state;
}

export function useCalendlyInviteeOptions(enabled: boolean, eventUuid: string): PickerState {
  const [state, setState] = useState<PickerState>(EMPTY);

  useEffect(() => {
    const uuid = eventUuid.trim();
    if (!enabled || !uuid) {
      setState(EMPTY);
      return;
    }
    let cancelled = false;
    setState({ options: [], loading: true, error: null });
    void listCalendlyInvitees(uuid).then((result) => {
      if (cancelled) return;
      if (!result.success) {
        setState({ options: [], loading: false, error: result.error ?? "Failed to load invitees" });
        return;
      }
      setState({ options: result.data?.options ?? [], loading: false, error: null });
    });
    return () => {
      cancelled = true;
    };
  }, [enabled, eventUuid]);

  return state;
}

export function useCalendlyContactOptions(enabled: boolean): PickerState {
  const [state, setState] = useState<PickerState>(EMPTY);

  useEffect(() => {
    if (!enabled) {
      setState(EMPTY);
      return;
    }
    let cancelled = false;
    setState({ options: [], loading: true, error: null });
    void listCalendlyContacts().then((result) => {
      if (cancelled) return;
      if (!result.success) {
        setState({ options: [], loading: false, error: result.error ?? "Failed to load contacts" });
        return;
      }
      setState({ options: result.data?.options ?? [], loading: false, error: null });
    });
    return () => {
      cancelled = true;
    };
  }, [enabled]);

  return state;
}

export function useCalendlyMeetingRecapOptions(enabled: boolean): PickerState {
  const [state, setState] = useState<PickerState>(EMPTY);

  useEffect(() => {
    if (!enabled) {
      setState(EMPTY);
      return;
    }
    let cancelled = false;
    setState({ options: [], loading: true, error: null });
    void listCalendlyMeetingRecaps().then((result) => {
      if (cancelled) return;
      if (!result.success) {
        setState({
          options: [],
          loading: false,
          error: result.error ?? "Failed to load meeting recaps"
        });
        return;
      }
      setState({ options: result.data?.options ?? [], loading: false, error: null });
    });
    return () => {
      cancelled = true;
    };
  }, [enabled]);

  return state;
}

export function useCalendlyAvailableTimeOptions(enabled: boolean, eventTypeUri: string): PickerState {
  const [state, setState] = useState<PickerState>(EMPTY);

  useEffect(() => {
    const uri = eventTypeUri.trim();
    if (!enabled || !uri) {
      setState(EMPTY);
      return;
    }
    let cancelled = false;
    setState({ options: [], loading: true, error: null });
    void listCalendlyAvailableTimes(uri).then((result) => {
      if (cancelled) return;
      if (!result.success) {
        setState({
          options: [],
          loading: false,
          error: result.error ?? "Failed to load available times"
        });
        return;
      }
      setState({ options: result.data?.options ?? [], loading: false, error: null });
    });
    return () => {
      cancelled = true;
    };
  }, [enabled, eventTypeUri]);

  return state;
}
