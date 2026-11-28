import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  Admin,
  Call,
  Client,
  CreateCallInput,
  MeetingWithRefs,
  Mentor,
  MentorTimeOff,
  Paginated,
  AvailabilityBlock,
} from '@calllog/shared';
import { api, qs } from './client';
import type {
  CallHistoryItem,
  CallWithClient,
  ClientDetail,
  ClientList,
  ClientMeetings,
  FreeSlots,
  Lookup,
  MeetingDetail,
  MentorDetailResponse,
  MentorListItem,
  ScheduledItem,
  Stats,
} from './types';

// ---- auth ----
export const useMe = () =>
  useQuery({
    queryKey: ['me'],
    queryFn: () => api<{ admin: Admin }>('/auth/me').then((r) => r.admin),
    retry: false,
    staleTime: 5 * 60_000,
  });

export const useLogin = () =>
  useMutation({
    mutationFn: (v: { email: string; password: string }) =>
      api<{ admin: Admin }>('/auth/login', { method: 'POST', body: v }),
  });

export const useChangePassword = () =>
  useMutation({
    mutationFn: (v: { currentPassword: string; newPassword: string }) =>
      api<{ ok: true }>('/auth/change-password', { method: 'POST', body: v }),
  });

// ---- reads ----
export const useLookup = (phone: string) =>
  useQuery({
    queryKey: ['lookup', phone],
    queryFn: () => api<Lookup>(`/clients/lookup${qs({ phone })}`),
    enabled: !!phone,
    retry: false,
    staleTime: 0,
  });

export const useClient = (id: string) =>
  useQuery({ queryKey: ['client', id], queryFn: () => api<ClientDetail>(`/clients/${id}`) });

export const useClients = (search: string) =>
  useQuery({
    queryKey: ['clients', search],
    queryFn: () => api<ClientList>(`/clients${search}`),
    placeholderData: (prev) => prev,
  });

export const useCalls = (search: string) =>
  useQuery({
    queryKey: ['calls', search],
    queryFn: () => api<Paginated<CallWithClient>>(`/calls${search}`),
    placeholderData: (prev) => prev,
  });

export const useScheduled = () =>
  useQuery({
    queryKey: ['scheduled'],
    queryFn: () => api<{ items: ScheduledItem[] }>('/scheduled'),
  });

export const useStats = () =>
  useQuery({ queryKey: ['stats'], queryFn: () => api<Stats>('/stats') });

export const useCallHistory = (callId: string, enabled: boolean) =>
  useQuery({
    queryKey: ['call-history', callId],
    queryFn: () => api<{ items: CallHistoryItem[] }>(`/calls/${callId}/history`),
    enabled,
  });

// ---- writes: every write refreshes anything that depends on calls/clients ----
function useWrite<TVars, TData>(fn: (v: TVars) => Promise<TData>) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: fn,
    onSuccess: () => {
      for (const key of [
        'client',
        'clients',
        'calls',
        'scheduled',
        'stats',
        'call-history',
        'lookup',
        'mentor',
        'mentors',
        'meetings',
        'meeting',
        'free-slots',
      ]) {
        void qc.invalidateQueries({ queryKey: [key] });
      }
    },
  });
}

export type ClientFields = { name: string; company: string; email: string; notes: string };

export const useCreateClient = () =>
  useWrite((v: ClientFields & { phone: string }) =>
    api<{ client: Client }>('/clients', { method: 'POST', body: v }),
  );

export const useUpdateClient = (id: string) =>
  useWrite((v: ClientFields) =>
    api<{ client: Client }>(`/clients/${id}`, { method: 'PATCH', body: v }),
  );

export const useDeleteClient = (id: string) =>
  useWrite(() => api<{ ok: true }>(`/clients/${id}`, { method: 'DELETE' }));

export type CallPayload = {
  direction: CreateCallInput['direction'];
  status: CreateCallInput['status'];
  summary: string;
  scheduledAt: string | null;
  notes: string;
};

export const useCreateCall = (clientId: string) =>
  useWrite((v: CallPayload) =>
    api<{ call: Call; client: Client }>(`/clients/${clientId}/calls`, { method: 'POST', body: v }),
  );

export const useUpdateCall = () =>
  useWrite((v: CallPayload & { id: string }) => {
    const { id, ...body } = v;
    return api<{ call: Call; client: Client }>(`/calls/${id}`, { method: 'PATCH', body });
  });

export const useDeleteCall = () =>
  useWrite((id: string) => api<{ ok: true }>(`/calls/${id}`, { method: 'DELETE' }));

// ---------- mentors ----------
export const useMentors = (search: string) =>
  useQuery({
    queryKey: ['mentors', search],
    queryFn: () => api<{ items: MentorListItem[] }>(`/mentors${search}`),
    placeholderData: (prev) => prev,
  });

export const useMentor = (id: string) =>
  useQuery({
    queryKey: ['mentor', id],
    queryFn: () => api<MentorDetailResponse>(`/mentors/${id}`),
  });

export type MentorFields = {
  name: string;
  email: string;
  phone: string;
  expertise: string[];
  bio: string;
  color?: string;
  timezone: string;
  defaultMeetingMinutes: number;
  isActive?: boolean;
};

export const useCreateMentor = () =>
  useWrite((v: MentorFields) => api<{ mentor: Mentor }>('/mentors', { method: 'POST', body: v }));

export const useUpdateMentor = (id: string) =>
  useWrite((v: Partial<MentorFields>) =>
    api<{ mentor: Mentor }>(`/mentors/${id}`, { method: 'PATCH', body: v }),
  );

export const useDeleteMentorPermanently = (id: string) =>
  useWrite(() => api<{ ok: true }>(`/mentors/${id}/permanent`, { method: 'DELETE' }));

export const useDeactivateMentor = (id: string) =>
  useWrite(() => api<{ ok: true; mentor: Mentor }>(`/mentors/${id}`, { method: 'DELETE' }));

export type AvailabilityInput = { weekday: number; startTime: string; endTime: string };
export const useSetAvailability = (id: string) =>
  useWrite((blocks: AvailabilityInput[]) =>
    api<{ availability: AvailabilityBlock[] }>(`/mentors/${id}/availability`, {
      method: 'PUT',
      body: { blocks },
    }),
  );

export const useTimeOff = (mentorId: string, from?: string, to?: string) =>
  useQuery({
    queryKey: ['time-off', mentorId, from ?? '', to ?? ''],
    queryFn: () =>
      api<{ items: MentorTimeOff[] }>(`/mentors/${mentorId}/time-off${qs({ from, to })}`),
    placeholderData: (prev) => prev,
  });

export const useCreateTimeOff = (mentorId: string) =>
  useWrite((v: { startAt: string; endAt: string; reason: string }) =>
    api<{ timeOff: MentorTimeOff }>(`/mentors/${mentorId}/time-off`, { method: 'POST', body: v }),
  );

export const useDeleteTimeOff = () =>
  useWrite((id: string) => api<{ ok: true }>(`/time-off/${id}`, { method: 'DELETE' }));

// ---------- meetings ----------
export const useMeetings = (search: string, enabled = true) =>
  useQuery({
    queryKey: ['meetings', search],
    queryFn: () => api<{ items: MeetingWithRefs[] }>(`/meetings${search}`),
    enabled,
    placeholderData: (prev) => prev,
  });

export const useMeeting = (id: string | null) =>
  useQuery({
    queryKey: ['meeting', id],
    queryFn: () => api<MeetingDetail>(`/meetings/${id}`),
    enabled: !!id,
  });

export const useClientMeetings = (clientId: string) =>
  useQuery({
    queryKey: ['client-meetings', clientId],
    queryFn: () => api<ClientMeetings>(`/clients/${clientId}/meetings`),
  });

export const useFreeSlots = (mentorId: string | null, search: string) =>
  useQuery({
    queryKey: ['free-slots', mentorId, search],
    queryFn: () => api<FreeSlots>(`/mentors/${mentorId}/free-slots${search}`),
    enabled: !!mentorId,
  });

export const useClientSearch = (text: string) =>
  useQuery({
    queryKey: ['clients', 'picker', text],
    queryFn: () => api<ClientList>(`/clients${qs({ search: text })}`),
    enabled: text.trim().length >= 2,
  });

export type MeetingInput = {
  mentorId: string;
  clientId: string;
  title: string;
  startAt: string;
  endAt: string;
  mode: 'online' | 'in_person' | 'phone';
  locationOrLink: string;
  agenda: string;
  force?: boolean;
  logCall?: boolean;
};

export const useCreateMeeting = () =>
  useWrite((v: MeetingInput) =>
    api<{ meeting: MeetingWithRefs; call: Call | null }>('/meetings', { method: 'POST', body: v }),
  );

export type MeetingPatch = Partial<Omit<MeetingInput, 'mentorId' | 'clientId'>> & {
  status?: MeetingWithRefs['status'];
  notes?: string;
};

export const useUpdateMeeting = () =>
  useWrite((v: MeetingPatch & { id: string }) => {
    const { id, ...body } = v;
    return api<{ meeting: MeetingWithRefs; call: Call | null }>(`/meetings/${id}`, {
      method: 'PATCH',
      body,
    });
  });

export const useDeleteMeeting = () =>
  useWrite((id: string) => api<{ ok: true }>(`/meetings/${id}`, { method: 'DELETE' }));
