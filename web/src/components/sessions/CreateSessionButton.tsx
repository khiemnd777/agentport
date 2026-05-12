import { Plus } from "lucide-react";

interface Props {
  disabled: boolean;
  onCreate: () => void;
}

export default function CreateSessionButton({ disabled, onCreate }: Props) {
  return (
    <button className="icon-text-button primary" type="button" disabled={disabled} onClick={onCreate}>
      <Plus size={17} /> New Chat
    </button>
  );
}
