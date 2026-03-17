import { SearchLivePanel } from '@/components/chat/SearchLivePanel';
import type { SearchPanelModel } from '@/lib/searchPanelModel';

interface SearchPanelProps {
  model: SearchPanelModel;
}

export function SearchPanel({ model }: SearchPanelProps) {
  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden rounded-[32px] border border-border/60 bg-card/35 p-3">
      <div className="min-h-0 flex-1 overflow-y-auto scrollbar-thin">
        <SearchLivePanel model={model} />
      </div>
    </div>
  );
}
