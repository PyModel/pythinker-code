/**
 * TodoListTool — structured TODO list management tool.
 *
 * The LLM uses this tool to maintain a visible plan of sub-tasks during
 * plan-mode workflows and multi-step operations. A single tool serves
 * both reads and writes:
 *
 *   - `resolveExecution({ todos: [...] })` — replace the full list
 *   - `resolveExecution({ todos: [] })`    — clear the list
 *   - `resolveExecution({})`               — query current list (no mutation)
 *
 * Storage: todos live in the agent-level tool store. Writes go through
 * `tools.update_store`, so the store update is visible on wire replay.
 */

import { z } from 'zod';

import type { BuiltinTool } from '../../../agent/tool';
import type { ToolExecution } from '../../../loop/types';
import { toInputJsonSchema } from '../../support/input-schema';
import {
  needsVerificationNudge,
  VERIFICATION_NUDGE,
} from '../../support/verification-nudge';
import type { ToolStore } from '../../store';
import DESCRIPTION from './todo-list.md?raw';

// ── TODO state shape ─────────────────────────────────────────────────

export const TODO_LIST_TOOL_NAME = 'TodoList' as const;
export const TODO_STORE_KEY = 'todo';
const TODO_LIST_WRITE_REMINDER =
  'Ensure that you continue to use the todo list to track progress. Mark tasks done immediately after finishing them, and keep exactly one task in_progress when work is underway.';

export type TodoStatus = 'pending' | 'in_progress' | 'done';

export interface TodoItem {
  readonly title: string;
  readonly activeForm?: string;
  readonly status: TodoStatus;
}

declare module '../../store' {
  interface ToolStoreData {
    todo: readonly TodoItem[];
  }
}

// ── Schema ───────────────────────────────────────────────────────────

const TodoInputStatusSchema = z
  .enum(['pending', 'in_progress', 'done', 'completed'])
  .describe('Current status of the todo. done and completed are equivalent.');

const NativeTodoItemSchema = z.object({
  title: z.string().min(1).describe('Short, actionable title for the todo.'),
  activeForm: z.string().min(1).optional().describe('Present-continuous activity label.'),
  status: TodoInputStatusSchema,
});

// Accept the older TodoWrite-style shape for compatibility, then normalize it
// into the native TodoList store/render contract below.
const TodoWriteItemSchema = z.object({
  content: z.string().min(1).describe('Imperative description of the task.'),
  activeForm: z.string().min(1).describe('Present-continuous activity label.'),
  status: TodoInputStatusSchema,
});

type TodoListInputItem =
  | z.infer<typeof NativeTodoItemSchema>
  | z.infer<typeof TodoWriteItemSchema>;

export interface TodoListInput {
  todos?: TodoListInputItem[];
}

export const TodoListInputSchema: z.ZodType<TodoListInput> = z.object({
  todos: z
    .array(z.union([NativeTodoItemSchema, TodoWriteItemSchema]))
    .optional()
    .describe(
      'The updated todo list. Omit to read the current todo list without making changes. Pass an empty array to clear the list.',
    ),
});

// ── Implementation ───────────────────────────────────────────────────

export function renderTodoList(todos: readonly TodoItem[], title = 'Current todo list:'): string {
  if (todos.length === 0) {
    return 'Todo list is empty.';
  }
  const lines = todos.map((t) => {
    const marker = statusMarker(t.status);
    return `  ${marker} ${t.title}`;
  });
  return [title, ...lines].join('\n');
}

function statusMarker(status: TodoStatus): string {
  switch (status) {
    case 'pending':
      return '[pending]';
    case 'in_progress':
      return '[in_progress]';
    case 'done':
      return '[done]';
    default: {
      const _exhaustive: never = status;
      return _exhaustive;
    }
  }
}

export class TodoListTool implements BuiltinTool<TodoListInput> {
  readonly name = TODO_LIST_TOOL_NAME;
  readonly description: string = DESCRIPTION;
  readonly parameters: Record<string, unknown> = toInputJsonSchema(TodoListInputSchema);

  constructor(
    private readonly store: ToolStore,
    private readonly mainAgent = true,
  ) {}

  resolveExecution(args: TodoListInput): ToolExecution {
    const description =
      args.todos === undefined
        ? 'Reading todo list'
        : args.todos.length === 0
          ? 'Clearing todo list'
          : 'Updating todo list';
    return {
      description,
      display: {
        kind: 'todo_list',
        items: (args.todos ?? this.getTodos()).map((todo) => ({ ...todo })),
      },
      approvalRule: this.name,
      execute: async () => {
        // Query mode — return the current list without mutation.
        if (args.todos === undefined) {
          const current = this.getTodos();
          return { isError: false, output: renderTodoList(current) };
        }

        if (args.todos.length === 0) {
          this.setTodos([]);
          return { isError: false, output: 'Todo list cleared.' };
        }

        const todos = args.todos.map(normalizeTodoItem);
        const allDone = todos.every((todo) => todo.status === 'done');
        const verificationNudge =
          this.mainAgent &&
          allDone &&
          needsVerificationNudge(todos.map((todo) => todo.title))
            ? VERIFICATION_NUDGE
            : '';
        this.setTodos(allDone ? [] : todos);
        const output = `Todo list updated.\n${renderTodoList(todos)}\n\n${TODO_LIST_WRITE_REMINDER}${verificationNudge}`;
        return { isError: false, output };
      },
    };
  }

  private getTodos(): readonly TodoItem[] {
    const todos = this.store.get(TODO_STORE_KEY);
    return todos ?? [];
  }

  private setTodos(todos: readonly TodoItem[]): void {
    this.store.set(
      TODO_STORE_KEY,
      todos.map((todo) => ({
        title: todo.title,
        activeForm: todo.activeForm,
        status: todo.status,
      })),
    );
  }
}

function normalizeTodoItem(todo: TodoListInputItem): TodoItem {
  const status = todo.status === 'completed' ? 'done' : todo.status;
  if ('title' in todo) {
    return {
      title: todo.title,
      activeForm: todo.activeForm,
      status,
    };
  }
  return {
    title: todo.content,
    activeForm: todo.activeForm,
    status,
  };
}
