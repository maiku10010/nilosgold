import importlib.util
import unittest
from decimal import Decimal as D
from pathlib import Path

spec = importlib.util.spec_from_file_location('reconcile', Path(__file__).parents[1] / 'scripts/reconcile_legacy.py')
m = importlib.util.module_from_spec(spec)
spec.loader.exec_module(m)

class ReconcileTests(unittest.TestCase):
    def test_unrecorded_balance_means_full_payment(self):
        self.assertEqual(m.financial(D('100'), D('20'), None), (D('100'), D('0'), D('80'), D('0')))
        self.assertEqual(m.financial(D('100'), D('20'), D('0')), (D('100'), D('0'), D('80'), D('0')))

    def test_arithmetic_replaces_incorrect_positive_balance(self):
        self.assertEqual(m.financial(D('32000'), D('28000'), D('2000'))[1], D('4000'))

    def test_excess_is_separate_not_negative_receivable(self):
        self.assertEqual(m.financial(D('200'), D('300'), D('-100')), (D('300'), D('0'), D('0'), D('100')))

    def test_status_negation_precedes_finished(self):
        for raw in ['not', 'not yet', 'dont', 'Don’t', 'Done paid but not yet finished']:
            self.assertEqual(m.status(raw, D('100'), D('100')), 'Fully Paid, Unfinished Product')
            self.assertEqual(m.status(raw, D('20'), D('100')), 'Not Yet Finished')
        self.assertEqual(m.status('Done not paid', D('20'), D('100')), 'Finished Product, Unpaid')
        self.assertEqual(m.status('cancelled', D('100'), D('100')), 'Cancelled')

    def test_unknowns_and_malformed_values(self):
        self.assertEqual(m.financial(None, D('100'), None), (None, None, None, None))
        self.assertIsNone(m.number('#DIV/0!'))
        self.assertIsNone(m.valid_date('2026-02-30'))
        with self.assertRaises(ValueError): m.number('123 pesos')
        self.assertEqual(m.money(D('2.675')), '2.68')

if __name__ == '__main__': unittest.main()
