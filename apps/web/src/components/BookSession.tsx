import { useState } from 'react';
import type { Client, Slot } from '@calllog/shared';
import { useMentors } from '../api/hooks';
import type { MentorListItem } from '../api/types';
import { FreeSlotFinder } from './FreeSlotFinder';
import { MeetingModal } from './MeetingModal';
import { Modal } from './Modal';
import { ErrorState, Loading } from './States';

interface Props {
  /** Pre-selected client (e.g. from the client page). */
  client?: Client | null;
  /** Restrict the search to these mentors; empty means all active. */
  mentorIds?: string[];
  title?: string;
  onClose: () => void;
}

/** Pick a free slot across mentors, then book it in the normal meeting form. */
export function BookSession({
  client = null,
  mentorIds = [],
  title = 'Find a free slot',
  onClose,
}: Props) {
  const mentors = useMentors('');
  const [picked, setPicked] = useState<{ mentor: MentorListItem; slot: Slot } | null>(null);

  if (picked) {
    return (
      <MeetingModal
        mode="create"
        mentor={picked.mentor}
        client={client}
        initialStart={picked.slot.start}
        initialEnd={picked.slot.end}
        onClose={onClose}
      />
    );
  }
  return (
    <Modal title={title} onClose={onClose}>
      {mentors.isLoading && <Loading />}
      {mentors.error && <ErrorState error={mentors.error} onRetry={() => mentors.refetch()} />}
      {mentors.data && (
        <FreeSlotFinder
          mentors={mentors.data.items}
          mentorIds={mentorIds}
          onPick={(mentor, slot) => setPicked({ mentor, slot })}
        />
      )}
    </Modal>
  );
}
