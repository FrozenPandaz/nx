import { UnitTestRunner } from '../../utils/test-runners';
export interface Schema {
  name: string;
  skipFormat: boolean;
  skipPackageJson: boolean;
  framework: 'express' | 'apollo' | 'nestjs' | 'none';
  directory?: string;
  unitTestRunner: UnitTestRunner;
  tags?: string;
}

export interface NormalizedSchema extends Schema {
  appProjectRoot: Path;
  e2eProjectName: string;
  e2eProjectRoot: Path;
  parsedTags: string[];
}
