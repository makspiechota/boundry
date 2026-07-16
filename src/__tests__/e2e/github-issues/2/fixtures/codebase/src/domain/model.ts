export interface Story {
  id: string;
  points: number;
}

export const total = (stories: Story[]): number =>
  stories.reduce((sum, s) => sum + s.points, 0);
