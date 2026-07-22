"use client";

import type { WorkflowTriggerKind } from "@coreai/shared";
import {
  BusinessHoursSection,
  type EmbeddedSectionApi
} from "@/components/business/business-hours-section";
import type {
  AppointmentDayHours,
  AppointmentWeekday,
  BusinessHoursData
} from "@/components/business/features/api";
import { AppointmentHoursEditor, type ApptNumberField } from "./appointment-hours-editor";
import type { BookingRulesValidation } from "./booking-rules-panel";
import {
  AiCallCoverageEditor,
  type AiCoverageKind,
  type AnsweringDayRow
} from "./ai-call-coverage-editor";


export function HoursAvailabilitySection({
  timeZone,
  persistTimeZone = true,
  onBusinessHoursLoaded,
  onBusinessHoursSaved,
  onBusinessHoursChange,
  onBusinessHoursDirtyChange,
  registerBusinessHoursApi,
  businessHoursRefreshToken,
  businessHoursSummary,
  businessHoursConfigured,
  apptUseBusinessHours,
  onApptUseBusinessHours,
  apptDays,
  onApptDay,
  apptFields,
  onApptField,
  apptRulesValidation,
  apptConfirmed,
  onApptConfirmed,
  apptLoaded,
  coverageKind,
  onCoverageKind,
  answeringDays,
  onAnsweringDay,
  triggerKind
}: {
  /** Authoritative business timezone — owned by the Connect step, passed through to the hours editor. */
  timeZone: string;
  /** False until the buyer edits the timezone this session (stale-tab guard). */
  persistTimeZone?: boolean;
  onBusinessHoursLoaded: (data: BusinessHoursData) => void;
  onBusinessHoursSaved: (data: BusinessHoursData) => void;
  onBusinessHoursChange?: (data: BusinessHoursData) => void;
  onBusinessHoursDirtyChange: (dirty: boolean) => void;
  registerBusinessHoursApi: (api: EmbeddedSectionApi | null) => void;
  /** Bump after document changes so the hours editor re-reads its suggestion. */
  businessHoursRefreshToken?: number;
  businessHoursSummary: string[] | null;
  businessHoursConfigured: boolean;
  apptUseBusinessHours: boolean;
  onApptUseBusinessHours: (value: boolean) => void;
  apptDays: Record<AppointmentWeekday, AppointmentDayHours>;
  onApptDay: (day: AppointmentWeekday, patch: Partial<AppointmentDayHours>) => void;
  apptFields: Record<ApptNumberField, number>;
  onApptField: (field: ApptNumberField, value: number) => void;
  /** Page-level booking-rules validation result. */
  apptRulesValidation: BookingRulesValidation;
  apptConfirmed: boolean;
  onApptConfirmed: (value: boolean) => void;
  /** False until GET /setup/appointment-schedule resolves — editor hidden so an unloaded section can never clobber. */
  apptLoaded: boolean;
  coverageKind: AiCoverageKind;
  onCoverageKind: (kind: AiCoverageKind) => void;
  answeringDays: AnsweringDayRow[];
  onAnsweringDay: (day: string, patch: Partial<AnsweringDayRow>) => void;
  triggerKind?: WorkflowTriggerKind;
}) {
  return (
    <div className="space-y-6">
      {/* A. Business Hours — the ONLY weekly Business Hours editor. */}
      <div data-testid="business-setup-business-hours">
        <BusinessHoursSection
          title="Business Hours"
          embedded
          timeZoneOverride={timeZone}
          persistOverrideTimeZone={persistTimeZone}
          onLoaded={onBusinessHoursLoaded}
          onSaved={onBusinessHoursSaved}
          onChange={onBusinessHoursChange}
          onDirtyChange={onBusinessHoursDirtyChange}
          registerApi={registerBusinessHoursApi}
          refreshToken={businessHoursRefreshToken}
        />
      </div>

      {/* B. Appointment Hours — inherits Business Hours unless custom. */}
      {apptLoaded ? (
        <div className="border-t border-gray-100 pt-6">
          <AppointmentHoursEditor
            useBusinessHours={apptUseBusinessHours}
            onUseBusinessHours={onApptUseBusinessHours}
            businessHoursSummary={businessHoursSummary}
            businessHoursConfigured={businessHoursConfigured}
            days={apptDays}
            onDay={onApptDay}
            fields={apptFields}
            onField={onApptField}
            rulesValidation={apptRulesValidation}
            confirmed={apptConfirmed}
            onConfirmed={onApptConfirmed}
          />
        </div>
      ) : null}

      {/* C. AI Call Coverage — when the AI answers. */}
      <div className="border-t border-gray-100 pt-6">
        <AiCallCoverageEditor
          kind={coverageKind}
          onKind={onCoverageKind}
          answeringDays={answeringDays}
          onAnsweringDay={onAnsweringDay}
          businessHoursSummary={businessHoursSummary}
          businessHoursConfigured={businessHoursConfigured}
          triggerKind={triggerKind}
        />
      </div>
    </div>
  );
}
