import { describe, it, expect } from 'vitest';
import {
  parseEvaluationContent,
  consolidateDuplicates,
  parseAndConsolidate,
  generateTemplate,
} from '../parser';

describe('Purchase Evaluator Parser', () => {
  // ============================================
  // parseEvaluationContent
  // ============================================

  describe('parseEvaluationContent', () => {
    describe('basic CSV parsing', () => {
      it('should parse simple CSV with required columns', () => {
        const csv = `Set Number,Condition
75192,New
76139,Used`;

        const result = parseEvaluationContent(csv);

        expect(result.errors).toHaveLength(0);
        expect(result.items).toHaveLength(2);
        expect(result.items[0]).toMatchObject({
          setNumber: '75192',
          condition: 'New',
        });
        expect(result.items[1]).toMatchObject({
          setNumber: '76139',
          condition: 'Used',
        });
      });

      it('should parse CSV with all optional columns', () => {
        const csv = `Set Number,Set Name,Condition,Quantity,Cost
75192,Millennium Falcon,New,2,650.00
76139,1989 Batmobile,Used,1,180.50`;

        const result = parseEvaluationContent(csv);

        expect(result.errors).toHaveLength(0);
        expect(result.items).toHaveLength(2);
        expect(result.items[0]).toMatchObject({
          setNumber: '75192',
          setName: 'Millennium Falcon',
          condition: 'New',
          quantity: 2,
          cost: 650,
        });
        expect(result.hasCostColumn).toBe(true);
        expect(result.hasQuantityColumn).toBe(true);
      });

      it('should detect TSV (tab-separated) format', () => {
        const tsv = `Set Number\tCondition
75192\tNew
76139\tUsed`;

        const result = parseEvaluationContent(tsv);

        expect(result.errors).toHaveLength(0);
        expect(result.items).toHaveLength(2);
      });

      it('should handle quoted values with commas', () => {
        const csv = `Set Number,Set Name,Condition
75192,"Millennium Falcon, UCS",New`;

        const result = parseEvaluationContent(csv);

        expect(result.errors).toHaveLength(0);
        expect(result.items[0].setName).toBe('Millennium Falcon, UCS');
      });

      it('should handle escaped quotes in values', () => {
        const csv = `Set Number,Set Name,Condition
75192,"The ""Best"" Set",New`;

        const result = parseEvaluationContent(csv);

        expect(result.errors).toHaveLength(0);
        expect(result.items[0].setName).toBe('The "Best" Set');
      });

      it('should trim whitespace from values', () => {
        const csv = `Set Number, Condition
  75192  ,  New  `;

        const result = parseEvaluationContent(csv);

        expect(result.items[0].setNumber).toBe('75192');
        expect(result.items[0].condition).toBe('New');
      });

      it('should filter empty lines', () => {
        const csv = `Set Number,Condition

75192,New

76139,Used

`;

        const result = parseEvaluationContent(csv);

        expect(result.items).toHaveLength(2);
      });
    });

    describe('column name variations', () => {
      it('should accept "Item Code" as set number column', () => {
        const csv = `Item Code,Condition
75192,New`;

        const result = parseEvaluationContent(csv);

        expect(result.errors).toHaveLength(0);
        expect(result.items[0].setNumber).toBe('75192');
      });

      it('should accept "set_number" (snake_case) as set number column', () => {
        const csv = `set_number,condition
75192,New`;

        const result = parseEvaluationContent(csv);

        expect(result.errors).toHaveLength(0);
        expect(result.items[0].setNumber).toBe('75192');
      });

      it('should accept "Set #" as set number column', () => {
        const csv = `Set #,Condition
75192,New`;

        const result = parseEvaluationContent(csv);

        expect(result.errors).toHaveLength(0);
        expect(result.items[0].setNumber).toBe('75192');
      });

      it('should accept "Qty" as quantity column', () => {
        const csv = `Set Number,Condition,Qty
75192,New,3`;

        const result = parseEvaluationContent(csv);

        expect(result.items[0].quantity).toBe(3);
        expect(result.hasQuantityColumn).toBe(true);
      });

      it('should accept "Price" as cost column', () => {
        const csv = `Set Number,Condition,Price
75192,New,50.00`;

        const result = parseEvaluationContent(csv);

        expect(result.items[0].cost).toBe(50);
        expect(result.hasCostColumn).toBe(true);
      });

      it('should accept "Unit Cost" as cost column', () => {
        const csv = `Set Number,Condition,Unit Cost
75192,New,50.00`;

        const result = parseEvaluationContent(csv);

        expect(result.items[0].cost).toBe(50);
      });

      it('should accept "Description" as set name column', () => {
        const csv = `Set Number,Description,Condition
75192,Millennium Falcon,New`;

        const result = parseEvaluationContent(csv);

        expect(result.items[0].setName).toBe('Millennium Falcon');
      });

      it('should be case-insensitive for column headers', () => {
        const csv = `SET NUMBER,CONDITION
75192,NEW`;

        const result = parseEvaluationContent(csv);

        expect(result.errors).toHaveLength(0);
        expect(result.items[0].setNumber).toBe('75192');
      });
    });

    describe('condition parsing', () => {
      it('should parse "New" condition', () => {
        const csv = `Set Number,Condition
75192,New`;

        const result = parseEvaluationContent(csv);
        expect(result.items[0].condition).toBe('New');
      });

      it('should parse "Used" condition', () => {
        const csv = `Set Number,Condition
75192,Used`;

        const result = parseEvaluationContent(csv);
        expect(result.items[0].condition).toBe('Used');
      });

      it('should parse "N" as New', () => {
        const csv = `Set Number,Condition
75192,N`;

        const result = parseEvaluationContent(csv);
        expect(result.items[0].condition).toBe('New');
      });

      it('should parse "U" as Used', () => {
        const csv = `Set Number,Condition
75192,U`;

        const result = parseEvaluationContent(csv);
        expect(result.items[0].condition).toBe('Used');
      });

      it('should parse "Sealed" as New', () => {
        const csv = `Set Number,Condition
75192,Sealed`;

        const result = parseEvaluationContent(csv);
        expect(result.items[0].condition).toBe('New');
      });

      it('should parse "Opened" as Used', () => {
        const csv = `Set Number,Condition
75192,Opened`;

        const result = parseEvaluationContent(csv);
        expect(result.items[0].condition).toBe('Used');
      });

      it('should be case-insensitive for conditions', () => {
        const csv = `Set Number,Condition
75192,new
76139,USED`;

        const result = parseEvaluationContent(csv);
        expect(result.items[0].condition).toBe('New');
        expect(result.items[1].condition).toBe('Used');
      });
    });

    describe('cost parsing', () => {
      it('should parse cost with pound sign', () => {
        const csv = `Set Number,Condition,Cost
75192,New,£50.00`;

        const result = parseEvaluationContent(csv);
        expect(result.items[0].cost).toBe(50);
      });

      it('should parse cost with dollar sign', () => {
        const csv = `Set Number,Condition,Cost
75192,New,$75.99`;

        const result = parseEvaluationContent(csv);
        expect(result.items[0].cost).toBe(75.99);
      });

      it('should parse cost with euro sign', () => {
        const csv = `Set Number,Condition,Cost
75192,New,€60.50`;

        const result = parseEvaluationContent(csv);
        expect(result.items[0].cost).toBe(60.5);
      });

      it('should parse cost with comma thousands separator in quoted value', () => {
        const csv = `Set Number,Condition,Cost
75192,New,"1,250.00"`;

        const result = parseEvaluationContent(csv);
        expect(result.items[0].cost).toBe(1250);
      });

      it('should handle zero cost', () => {
        const csv = `Set Number,Condition,Cost
75192,New,0`;

        const result = parseEvaluationContent(csv);
        expect(result.items[0].cost).toBe(0);
      });

      it('should skip negative cost', () => {
        const csv = `Set Number,Condition,Cost
75192,New,-50`;

        const result = parseEvaluationContent(csv);
        expect(result.items[0].cost).toBeUndefined();
      });

      it('should skip invalid cost values', () => {
        const csv = `Set Number,Condition,Cost
75192,New,not-a-number`;

        const result = parseEvaluationContent(csv);
        expect(result.items[0].cost).toBeUndefined();
      });
    });

    describe('quantity parsing', () => {
      it('should parse integer quantity', () => {
        const csv = `Set Number,Condition,Quantity
75192,New,5`;

        const result = parseEvaluationContent(csv);
        expect(result.items[0].quantity).toBe(5);
      });

      it('should skip zero quantity', () => {
        const csv = `Set Number,Condition,Quantity
75192,New,0`;

        const result = parseEvaluationContent(csv);
        expect(result.items[0].quantity).toBeUndefined();
      });

      it('should skip negative quantity', () => {
        const csv = `Set Number,Condition,Quantity
75192,New,-2`;

        const result = parseEvaluationContent(csv);
        expect(result.items[0].quantity).toBeUndefined();
      });

      it('should truncate decimal quantity to integer', () => {
        const csv = `Set Number,Condition,Quantity
75192,New,3.7`;

        const result = parseEvaluationContent(csv);
        expect(result.items[0].quantity).toBe(3);
      });
    });

    describe('error handling', () => {
      it('should return error for empty input', () => {
        const result = parseEvaluationContent('');

        expect(result.errors).toHaveLength(1);
        expect(result.errors[0].message).toContain('No data found');
        expect(result.items).toHaveLength(0);
      });

      it('should return error for missing Set Number column', () => {
        const csv = `Name,Condition
Falcon,New`;

        const result = parseEvaluationContent(csv);

        expect(result.errors).toHaveLength(1);
        expect(result.errors[0].message).toContain('Set Number');
        expect(result.items).toHaveLength(0);
      });

      it('should return error for missing Condition column', () => {
        const csv = `Set Number,Name
75192,Falcon`;

        const result = parseEvaluationContent(csv);

        expect(result.errors).toHaveLength(1);
        expect(result.errors[0].message).toContain('Condition');
        expect(result.items).toHaveLength(0);
      });

      it('should return error for row with missing set number', () => {
        const csv = `Set Number,Condition
75192,New
,Used`;

        const result = parseEvaluationContent(csv);

        expect(result.items).toHaveLength(1);
        expect(result.errors).toHaveLength(1);
        expect(result.errors[0].row).toBe(3);
        expect(result.errors[0].message).toContain('Missing set number');
      });

      it('should return error for invalid condition', () => {
        const csv = `Set Number,Condition
75192,New
76139,Invalid`;

        const result = parseEvaluationContent(csv);

        expect(result.items).toHaveLength(1);
        expect(result.errors).toHaveLength(1);
        expect(result.errors[0].row).toBe(3);
        expect(result.errors[0].message).toContain('Invalid condition');
      });

      it('should include row number in error messages', () => {
        const csv = `Set Number,Condition
75192,New
,Used
76139,Bad`;

        const result = parseEvaluationContent(csv);

        expect(result.errors).toHaveLength(2);
        expect(result.errors[0].row).toBe(3);
        expect(result.errors[1].row).toBe(4);
      });
    });

    describe('metadata flags', () => {
      it('should set hasCostColumn true when cost column exists', () => {
        const csv = `Set Number,Condition,Cost
75192,New,50`;

        const result = parseEvaluationContent(csv);
        expect(result.hasCostColumn).toBe(true);
      });

      it('should set hasCostColumn false when cost column missing', () => {
        const csv = `Set Number,Condition
75192,New`;

        const result = parseEvaluationContent(csv);
        expect(result.hasCostColumn).toBe(false);
      });

      it('should set hasQuantityColumn true when quantity column exists', () => {
        const csv = `Set Number,Condition,Quantity
75192,New,2`;

        const result = parseEvaluationContent(csv);
        expect(result.hasQuantityColumn).toBe(true);
      });

      it('should set hasQuantityColumn false when quantity column missing', () => {
        const csv = `Set Number,Condition
75192,New`;

        const result = parseEvaluationContent(csv);
        expect(result.hasQuantityColumn).toBe(false);
      });
    });
  });

  // ============================================
  // consolidateDuplicates
  // ============================================

  describe('consolidateDuplicates', () => {
    it('should combine items with same set number and condition', () => {
      const items = [
        { setNumber: '75192', condition: 'New' as const },
        { setNumber: '75192', condition: 'New' as const },
        { setNumber: '75192', condition: 'New' as const },
      ];

      const result = consolidateDuplicates(items);

      expect(result).toHaveLength(1);
      expect(result[0].setNumber).toBe('75192');
      expect(result[0].quantity).toBe(3);
    });

    it('should keep items with same set number but different condition separate', () => {
      const items = [
        { setNumber: '75192', condition: 'New' as const },
        { setNumber: '75192', condition: 'Used' as const },
      ];

      const result = consolidateDuplicates(items);

      expect(result).toHaveLength(2);
    });

    it('should sum quantities when consolidating', () => {
      const items = [
        { setNumber: '75192', condition: 'New' as const, quantity: 2 },
        { setNumber: '75192', condition: 'New' as const, quantity: 3 },
      ];

      const result = consolidateDuplicates(items);

      expect(result).toHaveLength(1);
      expect(result[0].quantity).toBe(5);
    });

    it('should average cost when consolidating items with costs', () => {
      const items = [
        { setNumber: '75192', condition: 'New' as const, quantity: 1, cost: 100 },
        { setNumber: '75192', condition: 'New' as const, quantity: 1, cost: 200 },
      ];

      const result = consolidateDuplicates(items);

      expect(result).toHaveLength(1);
      expect(result[0].cost).toBe(150); // (100 + 200) / 2
    });

    it('should weight average cost by quantity', () => {
      const items = [
        { setNumber: '75192', condition: 'New' as const, quantity: 1, cost: 100 },
        { setNumber: '75192', condition: 'New' as const, quantity: 3, cost: 200 },
      ];

      const result = consolidateDuplicates(items);

      expect(result).toHaveLength(1);
      // (100 * 1 + 200 * 3) / 4 = 700 / 4 = 175
      expect(result[0].cost).toBe(175);
    });

    it('should use cost from item with cost when other has none', () => {
      const items = [
        { setNumber: '75192', condition: 'New' as const },
        { setNumber: '75192', condition: 'New' as const, cost: 50 },
      ];

      const result = consolidateDuplicates(items);

      expect(result[0].cost).toBe(50);
    });

    it('should keep longer name when consolidating', () => {
      const items = [
        { setNumber: '75192', condition: 'New' as const, setName: 'Falcon' },
        { setNumber: '75192', condition: 'New' as const, setName: 'Millennium Falcon UCS' },
      ];

      const result = consolidateDuplicates(items);

      expect(result[0].setName).toBe('Millennium Falcon UCS');
    });

    it('should not mutate original items', () => {
      const items = [
        { setNumber: '75192', condition: 'New' as const, quantity: 1 },
        { setNumber: '75192', condition: 'New' as const, quantity: 2 },
      ];

      consolidateDuplicates(items);

      expect(items[0].quantity).toBe(1);
      expect(items[1].quantity).toBe(2);
    });

    it('should handle empty array', () => {
      const result = consolidateDuplicates([]);
      expect(result).toEqual([]);
    });

    it('should handle single item array', () => {
      const items = [{ setNumber: '75192', condition: 'New' as const }];

      const result = consolidateDuplicates(items);

      expect(result).toHaveLength(1);
      expect(result[0].setNumber).toBe('75192');
    });
  });

  // ============================================
  // parseAndConsolidate
  // ============================================

  describe('parseAndConsolidate', () => {
    it('should parse and consolidate duplicates when no quantity column', () => {
      const csv = `Set Number,Condition
75192,New
75192,New
76139,Used`;

      const result = parseAndConsolidate(csv);

      expect(result.items).toHaveLength(2);
      expect(result.items.find((i) => i.setNumber === '75192')?.quantity).toBe(2);
    });

    it('should not consolidate when quantity column exists', () => {
      const csv = `Set Number,Condition,Quantity
75192,New,1
75192,New,1`;

      const result = parseAndConsolidate(csv);

      // When quantity column exists, we keep items separate
      expect(result.items).toHaveLength(2);
    });

    it('should pass through errors from parsing', () => {
      const csv = `Set Number,Condition
75192,Invalid`;

      const result = parseAndConsolidate(csv);

      expect(result.errors).toHaveLength(1);
    });

    it('should handle empty content', () => {
      const result = parseAndConsolidate('');

      expect(result.items).toHaveLength(0);
      expect(result.errors).toHaveLength(1);
    });
  });

  // ============================================
  // generateTemplate
  // ============================================

  describe('generateTemplate', () => {
    it('should generate CSV template with headers', () => {
      const template = generateTemplate();

      expect(template).toContain('Item Code');
      expect(template).toContain('Item Name');
      expect(template).toContain('Condition');
      expect(template).toContain('Quantity');
      expect(template).toContain('Cost');
    });

    it('should include sample data row', () => {
      const template = generateTemplate();
      const lines = template.split('\n');

      expect(lines).toHaveLength(2);
      expect(lines[1]).toContain('75192');
      expect(lines[1]).toContain('Millennium Falcon');
      expect(lines[1]).toContain('New');
    });

    it('should be parseable by parseEvaluationContent', () => {
      const template = generateTemplate();
      const result = parseEvaluationContent(template);

      expect(result.errors).toHaveLength(0);
      expect(result.items).toHaveLength(1);
      expect(result.items[0].setNumber).toBe('75192');
    });
  });
});
